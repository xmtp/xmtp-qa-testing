import fs from "fs";
import { appendFile } from "fs/promises";
import path from "path";
import { generateEncryptionKeyHex } from "@helpers/client";
import { defaultValues, type Client, type typeofStream } from "@helpers/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { WorkerClient } from "./main";

export interface WorkerBase {
  name: string;
  folder: string;
  walletKey: string;
  encryptionKey: string;
  testName: string;
}

export interface Worker extends WorkerBase {
  worker: WorkerClient;
  dbPath: string;
  client: Client;
  version: string;
  installationId: string;
  address: string;
}

/**
 * WorkerManager: A unified class for managing workers and their lifecycle
 * Combines the functionality of both WorkerManager and WorkerFactory
 */
export class WorkerManager {
  private workers: Record<string, Record<string, Worker>>;
  private testName: string;
  private activeWorkers: WorkerClient[] = [];
  private typeofStream: typeofStream;
  private gptEnabled: boolean;
  private keysCache: Record<
    string,
    { walletKey: string; encryptionKey: string }
  > = {};

  /**
   * Constructor creates an empty manager or populates it with existing workers
   */
  constructor(
    testName: string,
    typeofStream: typeofStream = "message",
    gptEnabled: boolean = false,
    existingWorkers?: Record<string, Record<string, Worker>>,
  ) {
    this.testName = testName;
    this.typeofStream = typeofStream;
    this.gptEnabled = gptEnabled;
    this.workers = existingWorkers || {};
  }
  /**
   * Terminates all active workers and cleans up resources
   */
  public async terminateAll(): Promise<void> {
    const terminationPromises = this.activeWorkers.map(async (worker) => {
      try {
        await worker.terminate();
      } catch (error) {
        console.warn(`Error terminating worker:`, error);
      }
    });

    await Promise.all(terminationPromises);
    this.activeWorkers = [];

    // Clear the workers object
    this.workers = {};
  }

  /**
   * Gets the total number of workers
   */
  public getLength(): number {
    let count = 0;
    for (const baseName in this.workers) {
      count += Object.keys(this.workers[baseName]).length;
    }
    return count;
  }

  /**
   * Gets a random subset of workers
   */
  public getRandomWorkers(count: number): Worker[] {
    const allWorkers = this.getWorkers();
    return allWorkers.sort(() => 0.5 - Math.random()).slice(0, count);
  }

  /**
   * Gets the version of the first worker (as a representative version)
   */
  public getVersion(): string {
    const firstBaseName = Object.keys(this.workers)[0];
    if (!firstBaseName) return "unknown";

    const firstInstallId = Object.keys(this.workers[firstBaseName])[0];
    if (!firstInstallId) return "unknown";

    return this.workers[firstBaseName][firstInstallId].version;
  }

  /**
   * Gets all workers as a flat array
   */
  public getWorkers(): Worker[] {
    const allWorkers: Worker[] = [];
    for (const baseName in this.workers) {
      for (const installationId in this.workers[baseName]) {
        allWorkers.push(this.workers[baseName][installationId]);
      }
    }
    return allWorkers;
  }

  /**
   * Gets a specific worker by name and optional installation ID
   */
  public get(
    baseName: string,
    installationId: string = "a",
  ): Worker | undefined {
    if (baseName.includes("-")) {
      const [name, id] = baseName.split("-");
      return this.workers[name]?.[id];
    }
    return this.workers[baseName]?.[installationId];
  }

  /**
   * Adds a worker to the manager
   */
  public addWorker(
    baseName: string,
    installationId: string,
    worker: Worker,
  ): void {
    if (!this.workers[baseName]) {
      this.workers[baseName] = {};
    }
    this.workers[baseName][installationId] = worker;
  }

  /**
   * Ensures a worker has wallet and encryption keys
   * Either retrieves from env vars or generates new ones
   */
  private ensureKeys(name: string): {
    walletKey: string;
    encryptionKey: string;
  } {
    // Extract the base name without installation ID for key lookup
    const baseName = name.split("-")[0];

    if (baseName in this.keysCache) {
      console.log(`Using cached keys for ${baseName}`);
      return this.keysCache[baseName];
    }

    const walletKeyEnv = `WALLET_KEY_${baseName.toUpperCase()}`;
    const encryptionKeyEnv = `ENCRYPTION_KEY_${baseName.toUpperCase()}`;

    // Check if keys exist in environment variables
    if (
      process.env[walletKeyEnv] !== undefined &&
      process.env[encryptionKeyEnv] !== undefined
    ) {
      const account = privateKeyToAccount(
        process.env[walletKeyEnv] as `0x${string}`,
      );
      console.log(`Using env keys for ${baseName}: ${account.address}`);

      this.keysCache[baseName] = {
        walletKey: process.env[walletKeyEnv],
        encryptionKey: process.env[encryptionKeyEnv],
      };

      return this.keysCache[baseName];
    }

    // Keys don't exist, generate new ones
    console.log(`Generating new keys for ${baseName}`);
    const walletKey = generatePrivateKey();
    const account = privateKeyToAccount(walletKey);
    const encryptionKey = generateEncryptionKeyHex();
    const publicKey = account.address;

    // Store in cache
    this.keysCache[baseName] = {
      walletKey,
      encryptionKey,
    };

    // Update process.env directly so subsequent calls in the same process will find the keys
    process.env[walletKeyEnv] = walletKey;
    process.env[encryptionKeyEnv] = encryptionKey;

    if (!name.includes("random")) {
      // Append to .env file for persistence across runs
      const filePath =
        process.env.CURRENT_ENV_PATH || path.resolve(process.cwd(), ".env");
      void appendFile(
        filePath,
        `\n${walletKeyEnv}=${walletKey}\n${encryptionKeyEnv}=${encryptionKey}\n# public key is ${publicKey}\n`,
      );
    }

    return this.keysCache[baseName];
  }

  /**
   * Creates a new worker with all necessary initialization
   */
  public async createWorker(descriptor: string): Promise<Worker> {
    // Check if the worker already exists in our internal storage
    const [baseName, providedInstallId] = descriptor.split("-");

    if (providedInstallId && this.workers[baseName]?.[providedInstallId]) {
      console.log(`Reusing existing worker for ${descriptor}`);
      return this.workers[baseName][providedInstallId];
    }

    // Determine folder/installation ID
    const installationId = providedInstallId || getNextFolderName();
    const fullDescriptor = providedInstallId
      ? descriptor
      : `${baseName}-${installationId}`;

    // Get or generate keys
    const { walletKey, encryptionKey } = this.ensureKeys(fullDescriptor);

    // Create the base worker data
    const workerData: WorkerBase = {
      name: baseName,
      folder: installationId,
      testName: this.testName,
      walletKey,
      encryptionKey,
    };

    // Create and initialize the worker
    const workerClient = new WorkerClient(
      workerData,
      this.typeofStream,
      this.gptEnabled,
    );

    const initializedWorker = await workerClient.initialize();

    // Create the complete worker
    const worker: Worker = {
      ...workerData,
      client: initializedWorker.client,
      dbPath: initializedWorker.dbPath,
      version: initializedWorker.version,
      address: initializedWorker.address,
      installationId,
      worker: workerClient,
    };

    // Store the new worker for potential cleanup later
    this.activeWorkers.push(workerClient);

    // Add to our internal storage
    this.addWorker(baseName, installationId, worker);

    return worker;
  }

  /**
   * Creates multiple workers at once from descriptors
   */
  public async createWorkers(
    descriptorsOrAmount: string[] | number,
  ): Promise<Worker[]> {
    let descriptors: string[];

    // Handle numeric input (create N default workers)
    if (typeof descriptorsOrAmount === "number") {
      const workerNames = defaultValues.defaultNames;
      descriptors = workerNames.slice(0, descriptorsOrAmount);
    } else {
      descriptors = descriptorsOrAmount;
    }

    // Process descriptors in parallel
    const workerPromises = descriptors.map((descriptor) =>
      this.createWorker(descriptor),
    );
    return Promise.all(workerPromises);
  }
}

/**
 * Factory function to create a WorkerManager with initialized workers
 */
export async function getWorkers(
  descriptorsOrAmount: string[] | number,
  testName: string,
  typeofStream: typeofStream = "message",
  gptEnabled: boolean = false,
  existingWorkers?: WorkerManager,
): Promise<WorkerManager> {
  const manager =
    existingWorkers || new WorkerManager(testName, typeofStream, gptEnabled);
  await manager.createWorkers(descriptorsOrAmount);
  return manager;
}

/**
 * Helper function to get the next available folder name
 */
function getNextFolderName(): string {
  const dataPath = path.resolve(process.cwd(), ".data");
  let folder = "a";
  if (fs.existsSync(dataPath)) {
    const existingFolders = fs
      .readdirSync(dataPath)
      .filter((f) => /^[a-z]$/.test(f));
    folder = String.fromCharCode(
      "a".charCodeAt(0) + (existingFolders.length % 26),
    );
  }
  return folder;
}

/**
 * Helper function to count data subfolders
 */
export function getDataSubFolderCount() {
  const preBasePath = process.cwd();
  return fs.readdirSync(`${preBasePath}/.data`).length;
}
