import fs from "fs";
import { appendFile } from "fs/promises";
import path from "path";
import { generateEncryptionKeyHex } from "@helpers/client";
import { sdkVersions, sleep } from "@helpers/tests";
import { type Client, type Group, type XmtpEnv } from "@xmtp/node-sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { typeOfResponse, typeofStream, typeOfSync, WorkerClient } from "./main";

export interface WorkerBase {
  name: string;
  folder: string;
  walletKey: string;
  encryptionKey: string;
  testName: string;
  sdkVersion: string;
  libXmtpVersion: string;
}

export interface Worker extends WorkerBase {
  worker: WorkerClient;
  dbPath: string;
  client: Client;
  sdkVersion: string;
  libXmtpVersion: string;
  installationId: string;
  inboxId: string;
  env: XmtpEnv;
  folder: string;
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
  private typeofStream: typeofStream = typeofStream.Message;
  private typeOfResponse: typeOfResponse = typeOfResponse.Gm;
  private typeOfSync: typeOfSync = typeOfSync.None;
  private env: XmtpEnv;
  private keysCache: Record<
    string,
    { walletKey: string; encryptionKey: string }
  > = {};

  /**
   * Constructor creates an empty manager or populates it with existing workers
   */
  constructor(
    testName: string,
    typeofStreamType: typeofStream = typeofStream.Message,
    typeOfResponseType: typeOfResponse = typeOfResponse.Gm,
    typeOfSyncType: typeOfSync = typeOfSync.None,
    env: XmtpEnv,
  ) {
    this.testName = testName;
    this.typeofStream = typeofStreamType;
    this.typeOfResponse = typeOfResponseType;
    this.typeOfSync = typeOfSyncType;
    this.env = env;
    this.workers = {};
  }
  /**
   * Terminates all active workers and cleans up resources
   */
  public async terminateAll(deleteDbs: boolean = false): Promise<void> {
    console.debug(
      "terminating all workers",
      this.activeWorkers.length,
      this.activeWorkers,
    );
    const terminationPromises = this.activeWorkers.map(
      async (worker: WorkerClient) => {
        try {
          await worker.terminate();
          if (deleteDbs) {
            await worker.clearDB();
          }
        } catch (error) {
          console.warn(`Error terminating worker:`, error);
        }
      },
    );

    await Promise.all(terminationPromises);
    this.activeWorkers = [];
    this.workers = {};
    await sleep(500);
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
    const allWorkers = this.getAll();
    return allWorkers.sort(() => 0.5 - Math.random()).slice(0, count);
  }

  public getRandomWorker(): Worker {
    const allWorkers = this.getAll();
    return allWorkers[Math.floor(Math.random() * allWorkers.length)];
  }

  /**
   * Gets the version of the first worker (as a representative version)
   */
  public getVersion(): string {
    const firstBaseName = Object.keys(this.workers)[0];
    if (!firstBaseName) return "unknown";

    const firstInstallId = Object.keys(this.workers[firstBaseName])[0];
    if (!firstInstallId) return "unknown";

    return this.workers[firstBaseName][firstInstallId].sdkVersion;
  }

  public async packageDetails() {
    for (const worker of this.getAll()) {
      const installations = await worker.client.preferences.inboxState();
      const totalInstallations = installations.installations.length;
      if (totalInstallations > 10) {
        console.warn(`[${worker.name}] Package details: ${totalInstallations}`);
      }
      for (const installation of installations.installations) {
        // Convert nanoseconds to milliseconds for Date constructor
        const timestampMs = Number(installation.clientTimestampNs) / 1_000_000;
        const installationDate = new Date(timestampMs);
        const now = new Date();
        const diffMs = now.getTime() - installationDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        const daysText = diffDays === 1 ? "day" : "days";
        const greenCheck = diffDays < 90 ? " ✅" : "❌";

        if (diffDays > 90) {
          console.warn(
            `[${worker.name}] Installation: ${diffDays} ${daysText} ago${greenCheck}`,
          );
        }
      }
    }
  }
  public printWorkers() {
    try {
      let workersToPrint = [];
      for (const baseName in this.workers) {
        for (const installationId in this.workers[baseName]) {
          const currentWorker = this.workers[baseName][installationId];
          workersToPrint.push(
            `${baseName}-${installationId} ${currentWorker.address} ${currentWorker.sdkVersion}-${currentWorker.libXmtpVersion}`,
          );
        }
      }

      console.info("env", this.env);
      console.debug(JSON.stringify(workersToPrint, null, 2));
    } catch (error) {
      console.error(error);
    }
  }
  getCreator(): Worker {
    const workers = this.getAll();
    return workers[0];
  }
  getReceiver(): Worker {
    const workers = this.getAll();
    const creator = this.getCreator();
    const otherWorkers = workers.filter((worker) => worker !== creator);
    return otherWorkers[Math.floor(Math.random() * otherWorkers.length)];
  }
  async createGroup(
    groupName: string = `Test Group ${Math.random().toString(36).substring(2, 15)}`,
  ): Promise<Group> {
    const creator = this.getCreator();
    const group = await creator.client.conversations.newGroup(
      this.getAllButCreator().map((worker) => worker.client.inboxId),
      {
        groupName: groupName,
      },
    );
    return group;
  }
  getAllBut(excludeName: string): Worker[] {
    const workers = this.getAll();
    return workers.filter((worker) => worker.name !== excludeName);
  }
  getAllButCreator(): Worker[] {
    const workers = this.getAll();
    const creator = this.getCreator();
    return workers.filter((worker) => worker.name !== creator.name);
  }
  /**
   * Gets all workers as a flat array
   */
  public getAll(): Worker[] {
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
      const parts = baseName.split("-");
      const name = parts[0];
      const id = parts[1];
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
      console.debug(`Using cached keys for ${baseName}`);
      return this.keysCache[baseName];
    }

    const walletKeyEnv = `WALLET_KEY_${baseName.toUpperCase()}`;
    const encryptionKeyEnv = `ENCRYPTION_KEY_${baseName.toUpperCase()}`;

    // Check if keys exist in environment variables
    if (
      process.env[walletKeyEnv] !== undefined &&
      process.env[encryptionKeyEnv] !== undefined
    ) {
      this.keysCache[baseName] = {
        walletKey: process.env[walletKeyEnv],
        encryptionKey: process.env[encryptionKeyEnv],
      };

      return this.keysCache[baseName];
    }

    // Keys don't exist, generate new ones
    console.debug(`Generating new keys for ${baseName}`);
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
    const parts = descriptor.split("-");
    const baseName = parts[0];
    const providedInstallId = parts.length > 1 ? parts[1] : undefined;
    // Check if the worker already exists in our internal storage
    if (providedInstallId && this.workers[baseName]?.[providedInstallId]) {
      console.debug(`Reusing existing worker for ${descriptor}`);
      return this.workers[baseName][providedInstallId];
    }

    // Determine folder/installation ID
    const folder = providedInstallId || getNextFolderName();

    const sdkVersion = parts.length > 2 ? parts[2] : getLatestVersion();
    const libXmtpVersion = getLibxmtpVersion(sdkVersion);

    // Get or generate keys
    const { walletKey, encryptionKey } = this.ensureKeys(baseName);

    // Create the base worker data
    const workerData: WorkerBase = {
      name: baseName,
      folder,
      testName: this.testName,
      walletKey,
      encryptionKey,
      sdkVersion: sdkVersion,
      libXmtpVersion: libXmtpVersion,
    };

    // Create and initialize the worker
    const workerClient = new WorkerClient(
      workerData,
      this.typeofStream,
      this.typeOfResponse,
      this.typeOfSync,
      this.env,
    );

    const initializedWorker = await workerClient.initialize();

    // Create the complete worker
    const worker: Worker = {
      ...workerData,
      client: initializedWorker.client,
      inboxId: initializedWorker.client.inboxId,
      dbPath: initializedWorker.dbPath,
      sdkVersion: sdkVersion,
      libXmtpVersion: libXmtpVersion,
      address: initializedWorker.address,
      installationId: initializedWorker.client.installationId,
      env: this.env,
      folder,
      worker: workerClient,
    };

    // Store the new worker for potential cleanup later
    this.activeWorkers.push(workerClient);

    // Add to our internal storage
    this.addWorker(baseName, folder, worker);

    return worker;
  }
}

/**
 * Factory function to create a WorkerManager with initialized workers
 */
export async function getWorkers(
  descriptors: string[],
  testName: string,
  typeofStreamType: typeofStream = typeofStream.None,
  typeOfResponseType: typeOfResponse = typeOfResponse.None,
  typeOfSyncType: typeOfSync = typeOfSync.None,
  env: XmtpEnv = process.env.XMTP_ENV as XmtpEnv,
): Promise<WorkerManager> {
  const manager = new WorkerManager(
    testName,
    typeofStreamType,
    typeOfResponseType,
    typeOfSyncType,
    env,
  );
  // Process descriptors in parallel
  const workerPromises = descriptors.map((descriptor) =>
    manager.createWorker(descriptor),
  );
  await Promise.all(workerPromises);
  manager.printWorkers();
  await manager.packageDetails();
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
export function getLatestVersion(): string {
  return Object.keys(sdkVersions).pop() as string;
}

export function getLibxmtpVersion(sdkVersion: string): string {
  return sdkVersions[Number(sdkVersion) as keyof typeof sdkVersions]
    .libXmtpVersion;
}
