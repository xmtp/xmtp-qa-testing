import fs from "fs/promises";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import dotenv from "dotenv";
import { createSigner, getEncryptionKeyFromHex } from "./helper.js";

dotenv.config();

const { WALLET_KEY, ENCRYPTION_KEY } = process.env;

if (!WALLET_KEY) {
  throw new Error("WALLET_KEY must be set");
}

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY must be set");
}

const signer = createSigner(WALLET_KEY as `0x${string}`);
const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

const env: XmtpEnv = process.env.XMTP_ENV as XmtpEnv;

async function main() {
  console.log(`Creating client on the '${env}' network...`);
  let volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? ".data/xmtp";
  // Ensure the volume path directory exists
  try {
    await fs.mkdir(volumePath, { recursive: true });
    console.log(`Ensured directory exists: ${volumePath}`);
  } catch (error) {
    console.error(`Error creating directory ${volumePath}:`, error);
  }
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    console.log(
      `Using Railway volume path: ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`,
    );
    try {
      const files = await fs.readdir(volumePath);
      console.log(`Contents of ${volumePath}:`, files);
    } catch (error) {
      console.error(`Error reading directory ${volumePath}:`, error);
    }
  }
  const identifier = await signer.getIdentifier();
  const address = identifier.identifier;
  const dbPath = `${volumePath}/${address}-${env}`;

  const client = await Client.create(signer, encryptionKey, {
    env,
    dbPath,
    loggingLevel: process.env.LOGGING_LEVEL as any,
  });

  console.log("Syncing conversations...");
  await client.conversations.sync();

  console.log(
    `Agent initialized on ${address}\nSend a message on http://xmtp.chat/dm/${address}?env=${env}`,
  );

  console.log("Waiting for messages...");
  const stream = client.conversations.streamAllMessages();

  for await (const message of await stream) {
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    console.log(
      `Received message: ${message.content as string} by ${
        message.senderInboxId
      }`,
    );

    const conversation = await client.conversations.getConversationById(
      message.conversationId,
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    console.log(`Sending "gm" response...`);
    await conversation.send("gm");

    console.log("Waiting for messages...");
  }
}

main().catch(console.error);
