import fs from "fs";
import { getRandomValues } from "node:crypto";
import path from "node:path";
import {
  IdentifierKind,
  type NestedPersonas,
  type Signer,
  type XmtpEnv,
} from "@helpers/types";
import {
  generateInboxId as generateInboxIdBinding,
  getInboxIdForIdentifier as getInboxIdForIdentifierBinding,
  type Identifier,
} from "@xmtp/node-bindings";
import { ApiUrls } from "@xmtp/node-sdk";
import dotenv from "dotenv";
import { fromString, toString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { flushMetrics, initDataDog } from "./datadog";
import { createLogger, flushLogger, overrideConsole } from "./logger";
import { clearWorkerCache } from "./workers/factory";

interface User {
  key: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: ReturnType<typeof createWalletClient>;
}

export const createUser = (key: `0x${string}`): User => {
  const accountKey = key;
  const account = privateKeyToAccount(accountKey);
  return {
    key: accountKey,
    account,
    wallet: createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    }),
  };
};

export const createSigner = (key: `0x${string}`): Signer => {
  const user = createUser(key);
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

export const generateInboxId = (identifier: Identifier): string => {
  return generateInboxIdBinding(identifier);
};

export const getInboxIdForIdentifier = async (
  identifier: Identifier,
  env: XmtpEnv = "dev",
) => {
  const host = ApiUrls[env];
  const isSecure = host.startsWith("https");
  return getInboxIdForIdentifierBinding(host, isSecure, identifier);
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
  console.log("basePath", basePath);
  return basePath;
}
export const getDbPath = (
  name: string,
  accountAddress: string,
  testName: string,
  installationId: string,
  libxmtpVersion: string,
): string => {
  console.time(`[${name}] - getDbPath`);

  const env = process.env.XMTP_ENV as XmtpEnv;
  let identifier = `${accountAddress}-${libxmtpVersion}-${env}`;

  const basePath = loadDataPath(name, installationId, testName);

  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
    console.debug("Creating directory", basePath);
  }
  console.timeEnd(`[${name}] - getDbPath`);

  return `${basePath}/${identifier}`;
};

export const generateEncryptionKeyHex = () => {
  const uint8Array = getRandomValues(new Uint8Array(32));
  return toString(uint8Array, "hex");
};

export const getEncryptionKeyFromHex = (hex: string): Uint8Array => {
  return fromString(hex, "hex");
};

function getEnvPath(testName: string): string {
  let envPath = path.join(".env");
  if (testName.includes("bug")) {
    envPath = path.resolve(process.cwd(), "bugs/" + testName + "/.env");
  }
  console.log("envPath", envPath);
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
  const logger = createLogger(testName);
  overrideConsole(logger);
  dotenv.config({ path: getEnvPath(testName) });
  // Create the .env file path
  const env = process.env.XMTP_ENV;
  if (env !== "dev" && env !== "production" && env !== "local") {
    throw new Error("XMTP_ENV is not set in .env file or its not valid");
  }
  initDataDog(
    testName,
    process.env.XMTP_ENV ?? "",
    process.env.GEOLOCATION ?? "",
    process.env.DATADOG_API_KEY ?? "",
  );
}
export async function closeEnv(testName: string, personas: NestedPersonas) {
  flushLogger(testName);

  await flushMetrics();
  if (personas && typeof personas.getPersonas === "function") {
    for (const persona of personas.getPersonas()) {
      await persona.worker?.terminate();
    }
  }

  await clearWorkerCache();
}
