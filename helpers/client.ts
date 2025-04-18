import fs from "fs";
import { getRandomValues } from "node:crypto";
import path from "node:path";
import type { WorkerManager } from "@workers/manager";
import {
  IdentifierKind,
  type LogLevel,
  type Signer,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import dotenv from "dotenv";
import { fromString, toString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { flushMetrics, initDataDog } from "./datadog";
import { createLogger, flushLogger, overrideConsole } from "./logger";
import { sdkVersions } from "./tests";

interface User {
  key: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: ReturnType<typeof createWalletClient>;
}

export async function createClient(
  walletKey: `0x${string}`,
  encryptionKeyHex: string,
  workerData: {
    sdkVersion: string;
    name: string;
    testName: string;
    folder: string;
  },
  env: XmtpEnv,
): Promise<{
  client: unknown;
  dbPath: string;
  sdkVersion: string;
  libXmtpVersion: string;
  address: `0x${string}`;
}> {
  const encryptionKey = getEncryptionKeyFromHex(encryptionKeyHex);

  const sdkVersion = Number(workerData.sdkVersion);
  // Use type assertion to access the static version property
  const libXmtpVersion =
    sdkVersions[sdkVersion as keyof typeof sdkVersions].libXmtpVersion;

  const account = privateKeyToAccount(walletKey);
  const address = account.address;
  const dbPath = getDbPath(
    workerData.name,
    address,
    workerData.testName,
    workerData.folder,
    env,
  );

  // Use type assertion to handle the client creation
  const client = await regressionClient(
    sdkVersion,
    libXmtpVersion,
    walletKey,
    encryptionKey,
    dbPath,
    env,
  );

  return {
    client,
    dbPath,
    address,
    sdkVersion: String(sdkVersion),
    libXmtpVersion,
  };
}
export const regressionClient = async (
  sdkVersion: number,
  libXmtpVersion: string,
  walletKey: `0x${string}`,
  encryptionKey: Uint8Array,
  dbPath: string,
  env: XmtpEnv,
) => {
  const loggingLevel = process.env.LOGGING_LEVEL as LogLevel;
  const ClientClass =
    sdkVersions[sdkVersion as keyof typeof sdkVersions].Client;
  let client = null;
  let libXmtpVersionAfterClient = "unknown";
  if (sdkVersion == 30) {
    throw new Error("Invalid version");
  } else if (sdkVersion == 47) {
    const signer = createSigner47(walletKey);
    // @ts-expect-error: SDK version compatibility issues
    client = await ClientClass.create(signer, encryptionKey, {
      dbPath,
      env,
      loggingLevel,
    });
    libXmtpVersionAfterClient = getLibXmtpVersion(ClientClass);
  } else if (sdkVersion === 100 || sdkVersion === 105) {
    const signer = createSigner100(walletKey);
    // @ts-expect-error: SDK version compatibility issues
    client = await ClientClass.create(signer, encryptionKey, {
      dbPath,
      env,
      loggingLevel,
    });
    libXmtpVersionAfterClient = getLibXmtpVersion(ClientClass);
  } else if (sdkVersion === 202) {
    const signer = createSigner200(walletKey);
    // @ts-expect-error: SDK version compatibility issues
    client = await ClientClass.create(signer, {
      dbEncryptionKey: encryptionKey,
      dbPath,
      env,
    });
    libXmtpVersionAfterClient = getLibXmtpVersion(ClientClass);
  } else if (sdkVersion === 203) {
    const signer = createSigner200(walletKey);
    // @ts-expect-error: SDK version compatibility issues
    client = await ClientClass.create(signer, {
      dbEncryptionKey: encryptionKey,
      dbPath,
      env,
    });
    libXmtpVersionAfterClient = getLibXmtpVersion(ClientClass);
  } else {
    console.log("Invalid version" + String(sdkVersion));
    throw new Error("Invalid version" + String(sdkVersion));
  }

  if (libXmtpVersion !== libXmtpVersionAfterClient) {
    console.log(
      `libXmtpVersion mismatch: ${libXmtpVersionAfterClient} !== ${libXmtpVersion}`,
    );
  }

  return client;
};

// @ts-expect-error: SDK version compatibility issues
export const getLibXmtpVersion = (client: typeof ClientClass) => {
  try {
    const version = client.version;
    if (!version || typeof version !== "string") return "unknown";

    const parts = version.split("@");
    if (parts.length <= 1) return "unknown";

    const spaceParts = parts[1].split(" ");
    return spaceParts[0] || "unknown";
  } catch {
    return "unknown";
  }
};
export const createSigner47 = (privateKey: `0x${string}`) => {
  const account = privateKeyToAccount(privateKey);
  return {
    getAddress: () => account.address,
    signMessage: async (message: string) => {
      const signature = await account.signMessage({
        message,
      });
      return toBytes(signature);
    },
  };
};

export const createSigner100 = (key: `0x${string}`): Signer => {
  return createSigner200(key);
};
export const createSigner200 = (key: string): Signer => {
  const sanitizedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(sanitizedKey as `0x${string}`);
  let user: User = {
    key: sanitizedKey as `0x${string}`,
    account,
    wallet: createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    }),
  };
  return {
    type: "EOA",
    getIdentifier: () => ({
      identifierKind: IdentifierKind.Ethereum,
      identifier: user.account.address.toLowerCase(),
    }),
    signMessage: async (message: string) => {
      const signature = await user.wallet.signMessage({
        message,
        account: user.account,
      });
      return toBytes(signature);
    },
  };
};

export const createSigner = (key: `0x${string}`): Signer => {
  return createSigner200(key);
};

function loadDataPath(
  name: string,
  installationId: string,
  testName: string,
): string {
  // Extract the base name without installation ID for folder structure
  const baseName = name.toLowerCase().split("-")[0];
  const preBasePath = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? process.cwd();
  // Use baseName for the parent folder, not the full name
  let basePath = `${preBasePath}/.data/${baseName}/${installationId}`;

  if (testName.includes("bug")) {
    basePath = basePath.replace("/.data/", `/bugs/${testName}/.data/`);
  }
  return basePath;
}
export const getDbPath = (
  name: string,
  accountAddress: string,
  testName: string,
  installationId: string,
  env: XmtpEnv,
): string => {
  console.time(`[${name}] - getDbPath`);

  let identifier = `${accountAddress}-${env}`;

  const basePath = loadDataPath(name, installationId, testName);

  if (!fs.existsSync(basePath)) {
    console.log(`[${name}] Creating directory: ${basePath}`);
    fs.mkdirSync(basePath, { recursive: true });
  }

  const fullPath = `${basePath}/${identifier}`;

  console.timeEnd(`[${name}] - getDbPath`);

  return fullPath;
};

export const generateEncryptionKeyHex = () => {
  const uint8Array = getRandomValues(new Uint8Array(32));
  return toString(uint8Array, "hex");
};

export const getEncryptionKeyFromHex = (hex: string): Uint8Array => {
  return fromString(hex, "hex");
};

export function getDataPath(testName: string): string {
  let dataPath = path.join(".data");
  if (testName.includes("bug")) {
    dataPath = path.resolve(process.cwd(), "bugs/" + testName + "/.data");
  }
  return dataPath;
}
export function getEnvPath(testName: string): string {
  let envPath = path.join(".env");
  if (testName.includes("bug")) {
    envPath = path.resolve(process.cwd(), "bugs/" + testName + "/.env");
  }
  if (!fs.existsSync(envPath)) {
    // Create the directory structure for the env file
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    // Create the .env file if it doesn't exist
    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(envPath, `#XMTP\nLOGGING_LEVEL="off"\nXMTP_ENV="dev"\n`);
      console.log(`Created default .env file at ${envPath}`);
    }
  }
  process.env.CURRENT_ENV_PATH = envPath;
  return envPath;
}
/**
 * Loads environment variables from the specified test's .env file
 */
export function loadEnv(testName: string) {
  dotenv.config({ path: getEnvPath(testName) });
  console.log("Env path:", getEnvPath(testName), process.env.XMTP_ENV);
  const logger = createLogger(testName);
  overrideConsole(logger);

  initDataDog(
    testName,
    process.env.XMTP_ENV ?? "",
    process.env.GEOLOCATION ?? "",
    process.env.DATADOG_API_KEY ?? "",
  );
}

export async function closeEnv(testName: string, workers: WorkerManager) {
  flushLogger(testName);

  await flushMetrics(testName);
  if (workers && typeof workers.getWorkers === "function") {
    for (const worker of workers.getWorkers()) {
      await worker.worker.terminate();
    }
  }
}

export async function listInstallations(workers: WorkerManager) {
  for (const worker of workers.getWorkers()) {
    const inboxState = await worker.client?.preferences.inboxState();
    if (inboxState) {
      console.log(
        worker.name,
        "has",
        inboxState.installations.length,
        "installations",
      );
      //for (const installation of inboxState.installations) {
      // console.debug(
      //   worker.name +
      //     "(" +
      //     String(inboxState.installations.length) +
      //     ")" +
      //     installation.id,
      // );
      //}
    }
  }
}
