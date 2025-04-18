import fs from "fs/promises";
import { Client, type LogLevel, type XmtpEnv } from "@xmtp/node-sdk";
import dotenv from "dotenv";
import { createSigner, getEncryptionKeyFromHex } from "./helper.js";

dotenv.config();

const { WALLET_KEY, ENCRYPTION_KEY, GM_BOT_ADDRESS, XMTP_ENV, LOGGING_LEVEL } =
  process.env;

async function checkGmBot(): Promise<boolean> {
  if (
    !WALLET_KEY ||
    !ENCRYPTION_KEY ||
    !GM_BOT_ADDRESS ||
    !XMTP_ENV ||
    !LOGGING_LEVEL
  ) {
    throw new Error("Required environment variables must be set");
  }

  const signer = createSigner(WALLET_KEY as `0x${string}`);

  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
  const env: XmtpEnv = process.env.XMTP_ENV as XmtpEnv;

  try {
    let volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? ".data/xmtp";
    await fs.mkdir(volumePath, { recursive: true });
    const dbPath = `${volumePath}/check-${env}`;
    const client = await Client.create(signer, {
      dbEncryptionKey,
      env,
      dbPath,
      loggingLevel: process.env.LOGGING_LEVEL as LogLevel,
    });
    console.log("client", client.inboxId);
    return client.inboxId !== undefined;
  } catch (error) {
    console.error("Error checking GM bot:", error);
    return false;
  }
}

void checkGmBot();
