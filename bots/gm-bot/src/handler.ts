import { Client, XmtpEnv, DecodedMessage, Conversation, Dm } from "@xmtp/node-sdk";
import { createSigner, getEncryptionKeyFromHex, getDbPath, logAgentDetails, validateEnvironment } from "./helper";

const MAX_RETRIES = 6; // 6 times
const RETRY_DELAY_MS = 2000; // 2 seconds
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  

const { WALLET_KEY, ENCRYPTION_KEY } = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY"
]);

/**
 * Stream messages continuously with retry logic
 */
export const streamMessages = async (
  client: Client, 
  callBack: (client: Client, conversation: Conversation, message: DecodedMessage, isDm: boolean) => Promise<void>,
  options = { acceptGroups: false }
): Promise<void> => {
    const env = client.options?.env??'undefined';
    let retryCount = 0;
    while (retryCount < MAX_RETRIES) {
      try {
        console.log(
          `[${env}] Starting message stream... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
        );
        const streamPromise = client.conversations.streamAllMessages();
        const stream = await streamPromise;
  
        console.log(`[${env}] Waiting for messages...`);
        for await (const message of stream) {
          try {
            if (
              message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
              message?.contentType?.typeId !== "text"
            ) {
              continue;
            }
            
            const conversation = await client.conversations.getConversationById(message.conversationId);  
            if (!conversation) {
              console.log(`[${env}] Unable to find conversation, skipping`);
              continue;
            }
            
            console.log(
              `[${env}] Received message: ${message.content as string} by ${message.senderInboxId}`
            );
            
            const isDm = conversation instanceof Dm;
            
            if (isDm || options.acceptGroups) {
              await callBack(client, conversation, message, isDm);
            } else {
              console.log(`[${env}] Conversation is not a DM and acceptGroups=false, skipping`);
            }
          } catch (error) {
            console.error(error);
          }
        }
        retryCount = 0;
      } catch (error) {
        console.error(`[${env}] Error:`, error);
        retryCount++;
        await client.conversations.sync();
        await sleep(RETRY_DELAY_MS);
      }
    }
  };
  

/**
 * Initialize and set up an XMTP client for a specific environment
 */
export const initializeClient = async (
  callBack: (client: Client, conversation: Conversation, message: DecodedMessage, isDm: boolean) => Promise<void>,
  options = { acceptGroups: false }
): Promise<Client[]> => {
  const envs = ["dev", "production"];
  let clients: Client[] = [];
  let promises: Promise<void>[] = [];
  for (const env of envs) {
    try {
      const signer = createSigner(WALLET_KEY);
      const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
    
    const signerIdentifier = (await signer.getIdentifier()).identifier;
    const client = await Client.create(signer, {
      dbEncryptionKey,
      env: env as XmtpEnv,
      dbPath: getDbPath(`${env}-${signerIdentifier}`),
    });
  
    console.log(`[${env}] ✓ Syncing conversations...`);
    await client.conversations.sync();
    logAgentDetails(client);

    console.log("Waiting for messages...");
    promises.push(
      streamMessages(
        client, 
        async (client: Client, conversation: Conversation, message: DecodedMessage, isDm: boolean) => {
          try {
            await callBack(client, conversation, message, isDm);
                  
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[${env}] Error in callback:`, errorMessage);
          }
        },
        { acceptGroups: options.acceptGroups }
      )
    );
  
    clients.push(client);
    } catch (error) {
      console.error(`[${env}] Error:`, error);
    }
  } 
  await Promise.all(promises);
  return clients;
};
