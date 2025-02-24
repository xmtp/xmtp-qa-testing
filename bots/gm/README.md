## GM agent

This agent replies `gm`

> Try XMTP using [xmtp.chat](https://xmtp.chat)

## Basic usage

```tsx
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { createSigner, getEncryptionKeyFromHex } from "@/helpers";

const { WALLET_KEY, ENCRYPTION_KEY } = process.env;

if (!WALLET_KEY) {
  throw new Error("WALLET_KEY must be set");
}

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY must be set");
}

const signer = createSigner(WALLET_KEY);
const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

const env: XmtpEnv = "dev";

async function main() {
  console.log(`Creating client on the '${env}' network...`);
  const client = await Client.create(signer, encryptionKey, { env });

  console.log("Syncing conversations...");
  await client.conversations.sync();

  console.log(`Agent initialized on`, {
    inboxId: client.inboxId,
    accountAddress: client.accountAddress,
    deeplink: `https://xmtp.chat/dm/${client.accountAddress}?env=${env}`,
  });

  console.log("Waiting for messages...");
  const stream = client.conversations.streamAllMessages();

  for await (const message of await stream) {
    /* Ignore messages from the same agent or non-text messages */
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }
    console.log(
      `Received message: ${message.content as string} by ${message.senderInboxId}`,
    );

    const conversation = client.conversations.getConversationById(
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
```
