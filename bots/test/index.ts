import { loadEnv } from "@helpers/client";
import {
  type Client,
  type Conversation,
  type DecodedMessage,
  type WorkerManager,
  type XmtpEnv,
} from "@helpers/types";
import { getWorkers } from "@workers/manager";
import { CommandHandler } from "./commands";

const testName = "test-bot";
loadEnv(testName);

async function main() {
  try {
    const commandHandler = new CommandHandler();
    // First create the bot worker

    // Then create the dynamic workers
    console.log("Initializing worker workers...");
    const workers = await getWorkers(20, testName, "message", true);
    const botWorker = await getWorkers(["bot"], testName, "message", false);
    const bot = botWorker.get("bot");
    const client = bot?.client as Client;

    const env = process.env.XMTP_ENV as XmtpEnv;
    console.log(`Agent initialized on address ${bot?.address}`);
    console.log(`Agent initialized on inbox ${client.inboxId}`);
    console.log(`https://xmtp.chat/dm/${bot?.address}?env=${env}`);
    console.log("Syncing conversations...");
    await client.conversations.sync();

    //await sendInitialTestMessage(client);
    console.log("Waiting for messages...");
    try {
      const stream = client.conversations.streamAllMessages();
      for await (const message of await stream) {
        try {
          /* Ignore messages from the same agent or non-text messages */
          if (
            message?.senderInboxId.toLowerCase() ===
              client.inboxId.toLowerCase() ||
            message?.contentType?.typeId !== "text"
          ) {
            continue;
          }

          const conversation = await client.conversations.getConversationById(
            message.conversationId,
          );

          if (!conversation) {
            console.log("Unable to find conversation, skipping");
            continue;
          }
          console.log(
            `Received message: ${message.content as string} by ${message.senderInboxId}`,
          );

          // Parse the message content to extract command and arguments
          await processCommand(
            message,
            conversation,
            client,
            commandHandler,
            workers,
          );

          console.log("Waiting for messages...");
        } catch (error) {
          console.error("Error processing message:", error);
          // Continue the loop despite errors
        }
      }
    } catch (error) {
      console.error("Error streaming messages:", error);
      // Add more detailed error logging
      console.error("Error details:", JSON.stringify(error, null, 2));
    }
  } catch (error) {
    console.error("Error during initialization:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));
    process.exit(1);
  }
}

// async function sendInitialTestMessage(client: Client) {
//   // Send dm to the bot
//   const dm = await client.conversations.newDm(
//     process.env.CONVOS_USER as string,
//   );

//   await dm.send("gm from bot");
//   console.log("DM sent:", dm.id, "to", process.env.CONVOS_USER);

//   const dm2 = await client.conversations.newDm(process.env.CB_USER as string);
//   await dm2.send("gm from bot");
//   console.log("DM sent:", dm2.id, "to", process.env.CB_USER);
// }

// Helper function to process incoming commands
async function processCommand(
  message: DecodedMessage,
  conversation: Conversation,
  client: Client,
  commandHandler: CommandHandler,
  workers: WorkerManager,
) {
  try {
    const messageContent = message.content as string;
    const trimmedContent = messageContent.trim();

    if (trimmedContent.toLowerCase() === "gm") {
      await commandHandler.gm(message, client);
      return;
    }
    // Check if the message is a command (starts with '/')
    if (!trimmedContent.startsWith("/")) {
      return; // Not a command, ignore
    }

    // Extract command name and arguments
    const parts = trimmedContent.substring(1).split(" ");
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    console.log("Command:", command);
    console.log("Args:", args);
    // Execute the appropriate command handler
    switch (command) {
      case "help":
        await commandHandler.help(message, client);
        break;
      case "create":
        await commandHandler.create(message, client, args, workers);
        break;
      case "block":
        await commandHandler.block(message, client, args);
        break;
      case "unblock":
        await commandHandler.unblock(message, client, args);
        break;
      case "rename":
        await commandHandler.rename(message, client, args);
        break;
      case "me":
        await commandHandler.me(message, client);
        break;
      case "members":
        await commandHandler.members(message, client, workers);
        break;
      case "admins":
        await commandHandler.admins(message, client, workers);
        break;
      case "blast":
        await commandHandler.blast(message, client, args, workers);
        break;
      case "groups":
        await commandHandler.groups(message, client);
        break;
      case "broadcast":
        await commandHandler.broadcast(client, args);
        break;
      case "info":
        await commandHandler.info(message, client);
        break;
      case "workers":
        await commandHandler.workers(message, client, workers);
        break;
      case "leave":
        await commandHandler.leave(message, client);
        break;
      case "add":
        await commandHandler.add(message, client, args, workers);
        break;
      case "remove":
        await commandHandler.remove(message, client, args, workers);
        break;
      default:
        await conversation.send(
          `Unknown command: /${command}\nType /help to see available commands.`,
        );
        break;
    }
  } catch (error: unknown) {
    console.error("Error executing command:", error);
    try {
      await conversation.send(
        `Error executing command: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }
  }
}

// Run the bot
main().catch((error: unknown) => {
  console.error("Fatal error in main function:", error);
  console.error("Error details:", JSON.stringify(error, null, 2));
  process.exit(1); // Explicitly exit with error code
});
