import { Worker, type WorkerOptions } from "node:worker_threads";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import dotenv from "dotenv";
import { createSigner, getDbPath, getEncryptionKeyFromHex } from "./client";
// Adapt these imports
import type { PersonaBase } from "./personas";

dotenv.config();

export type WorkerMessage = {
  type: string;
  data: {
    content: string;
    conversationId?: string;
    senderAddress?: string;
  };
};

// This snippet is used as the "inline" JS for your Worker to import your worker code:
const workerBootstrap = /* JavaScript */ `
  import { createRequire } from "node:module";
  import { workerData } from "node:worker_threads";

  const filename = "${import.meta.url}";
  const require = createRequire(filename);
  const { tsImport } = require("tsx/esm/api");
  
  // This loads your worker code.
  tsImport(workerData.__ts_worker_filename, filename);
`;

export class WorkerClient extends Worker {
  public name: string;
  private installationId: string;
  private env: XmtpEnv;
  private version: string;

  private walletKey!: string;
  private encryptionKeyHex!: string;

  public client!: Client; // Expose the XMTP client if you need direct DM send

  constructor(persona: PersonaBase, env: XmtpEnv, options: WorkerOptions = {}) {
    options.workerData = {
      __ts_worker_filename: new URL("../helpers/worker.ts", import.meta.url)
        .pathname,
      persona,
      env,
    };

    super(new URL(`data:text/javascript,${workerBootstrap}`), options);

    this.name = persona.name;
    this.installationId = persona.installationId;
    this.version = persona.version;
    this.env = env;
    this.walletKey = persona.walletKey;
    this.encryptionKeyHex = persona.encryptionKey;

    // Add general message handler
    this.on("message", (message) => {
      console.log(`[${this.name}] Worker message:`, message);
    });

    // Handle worker errors
    this.on("error", (error) => {
      console.error(`[${persona.name}] Worker error:`, error);
    });

    // Handle worker exit
    this.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `[${persona.name}] Worker stopped with exit code ${code}`,
        );
      }
    });
  }

  /**
   * Initializes the underlying XMTP client in the worker thread.
   * Returns the XMTP Client object for convenience.
   */
  async initialize(): Promise<Client> {
    // Send initialization message to worker
    this.postMessage({
      type: "initialize",
      data: {
        name: this.name,
        installationId: this.installationId,
        version: this.version,
      },
    });

    const signer = createSigner(this.walletKey as `0x${string}`);
    const encryptionKey = getEncryptionKeyFromHex(this.encryptionKeyHex);

    const dbPath = getDbPath(
      this.name,
      this.installationId,
      this.version,
      this.env,
    );

    this.client = await Client.create(signer, encryptionKey, {
      env: this.env,
      dbPath,
    });

    // Start streaming in the background
    await this.startStream();
    await this.client.conversations.sync();
    return this.client;
  }

  /**
   * Internal helper that streams all messages and posts them
   * to the parent thread as { type: 'stream_message' } events.
   */
  private async startStream() {
    const stream = await this.client.conversations.streamAllMessages();
    console.log(`[${this.name}] Message stream started`);

    void (async () => {
      try {
        for await (const message of stream) {
          if (!message?.content) continue;

          const workerMessage: WorkerMessage = {
            type: "stream_message",
            data: {
              content: message.content as string,
              conversationId: message.conversationId,
              senderAddress: message.senderInboxId,
            },
          };

          // Only emit messages we're waiting for
          if (this.listenerCount("message") > 0) {
            this.emit("message", workerMessage);
          }
        }
      } catch (error) {
        console.error(`[${this.name}] Stream error:`, error);
        this.emit("error", error);
      }
    })();
  }

  /**
   * Expose a helper for waiting on a specific incoming message
   * in the parent. This sets up a one-off listener on this Worker
   * to resolve once the specified message text arrives.
   */
  receiveMessage(expectedContent: string): Promise<WorkerMessage> {
    console.log(`[${this.name}] Waiting for message: ${expectedContent}`);

    return new Promise<WorkerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener("message", messageHandler);
        reject(
          new Error(`Timeout: Did not receive '${expectedContent}' in time`),
        );
      }, 10000);

      const messageHandler = (msg: WorkerMessage) => {
        // If it's an error event, reject
        if (msg.type === "error") {
          clearTimeout(timeout);
          this.removeListener("message", messageHandler);
          reject(new Error(msg.data.content));
          return;
        }

        // If it's a matching stream message, resolve
        if (
          msg.type === "stream_message" &&
          msg.data.content === expectedContent
        ) {
          clearTimeout(timeout);
          this.removeListener("message", messageHandler);
          resolve(msg);
        }
      };

      this.on("message", messageHandler);
    });
  }
}
