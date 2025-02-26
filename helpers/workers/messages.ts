import { Worker, type WorkerOptions } from "node:worker_threads";
import { Client, type DecodedMessage, type XmtpEnv } from "@xmtp/node-sdk";
import { createSigner, getDbPath, getEncryptionKeyFromHex } from "../client";
import {
  defaultValues,
  type Conversation,
  type Persona,
  type PersonaBase,
  type VerifyStreamResult,
} from "../types";

export type MessageStreamWorker = {
  type: string;
  message: DecodedMessage;
};

// Snippet used as "inline" JS for Worker to import your worker code
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
  private sdkVersion: string;
  private testName: string;

  private walletKey: string;
  private encryptionKeyHex: string;

  public client!: Client; // Expose the XMTP client if you need direct DM

  constructor(persona: PersonaBase, env: XmtpEnv, options: WorkerOptions = {}) {
    options.workerData = {
      __ts_worker_filename: new URL("../workers/thread.ts", import.meta.url)
        .pathname,
      persona,
      env,
    };

    super(new URL(`data:text/javascript,${workerBootstrap}`), options);

    this.name = persona.name;
    this.installationId = persona.installationId;
    this.sdkVersion = persona.sdkVersion;
    this.env = env;
    this.testName = persona.testName;
    this.walletKey = persona.walletKey;
    this.encryptionKeyHex = persona.encryptionKey;

    // Log messages from the Worker
    this.on("message", (message) => {
      console.log(`[${this.name}] Worker message:`, message);
    });

    // Handle Worker errors
    this.on("error", (error) => {
      console.error(`[${persona.name}] Worker error:`, error);
    });

    // Handle Worker exit
    this.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `[${persona.name}] Worker stopped with exit code ${code}`,
        );
      }
    });
  }

  /**
   * Initializes the underlying XMTP client in the Worker.
   * Returns the XMTP Client object for convenience.
   */
  async initialize(): Promise<{
    client: Client;
    dbPath: string;
    version: string;
  }> {
    console.time(`[${this.name}] Initialize XMTP client`);

    // Tell the Worker to do any internal initialization
    this.postMessage({
      type: "initialize",
      data: {
        name: this.name,
        installationId: this.installationId,
        sdkVersion: this.sdkVersion,
      },
    });

    const signer = createSigner(this.walletKey as `0x${string}`);
    const encryptionKey = getEncryptionKeyFromHex(this.encryptionKeyHex);
    const version = Client.version.match(/ci@([a-f0-9]+)/)?.[1];
    const dbPath = getDbPath(
      this.name,
      await signer.getAddress(),
      this.env,
      {
        installationId: this.installationId,
        sdkVersion: this.sdkVersion,
        libxmtpVersion: version,
      },
      {
        testName: this.testName,
      },
    );
    console.time(`[${this.name}] Create XMTP client v:${version}`);
    this.client = await Client.create(signer, encryptionKey, {
      env: this.env,
      dbPath,
      // @ts-expect-error: loggingLevel is not typed
      loggingLevel: process.env.LOGGING_LEVEL,
    });
    console.timeEnd(`[${this.name}] Create XMTP client v:${version}`);

    // Start streaming in the background
    console.time(`[${this.name}] Start stream`);
    await this.startStream();
    console.timeEnd(`[${this.name}] Start stream`);

    // Sync conversations
    console.time(`[${this.name}] Sync conversations`);
    await this.client.conversations.sync();
    console.timeEnd(`[${this.name}] Sync conversations`);

    console.timeEnd(`[${this.name}] Initialize XMTP client`);
    return { client: this.client, dbPath, version: Client.version };
  }

  /**
   * Internal helper to stream all messages from the client,
   * then emit them as 'stream_message' events on this Worker.
   */
  private async startStream() {
    console.time(`[${this.name}] Start message stream`);
    const stream = await this.client.conversations.streamAllMessages();
    console.timeEnd(`[${this.name}] Start message stream`);
    console.log(`[${this.name}] Message stream started`);

    // Process messages asynchronously
    void (async () => {
      try {
        for await (const message of stream) {
          console.time(`[${this.name}] Process message`);
          const workerMessage: MessageStreamWorker = {
            type: "stream_message",
            message: message as DecodedMessage,
          };
          // Emit if any listeners are attached
          if (this.listenerCount("message") > 0) {
            this.emit("message", workerMessage);
          }
          console.timeEnd(`[${this.name}] Process message`);
        }
      } catch (error) {
        console.error(`[${this.name}] Stream error:`, error);
        this.emit("error", error);
      }
    })();
  }

  /**
   * Collects a fixed number of messages matching:
   * - a specific conversation (topic or peer address),
   * - a specific contentType ID,
   * - and containing a random suffix in the message content (to avoid duplicates).
   *
   * @param conversationId - Usually `group.topic` or similar
   * @param typeId - Content type to filter (e.g. "text")
   * @param suffix - Unique substring used in messages
   * @param count - Number of messages to gather
   * @param timeoutMs - Optional max time in milliseconds
   *
   * @returns Promise resolving with an array of WorkerMessage
   */
  collectMessages(
    groupId: string,
    typeId: string,
    suffix: string,
    count: number,
    timeoutMs = count * defaultValues.perMessageTimeout,
  ): Promise<MessageStreamWorker[]> {
    console.log(
      `[${this.name}] Collecting ${count} '${typeId}' messages from convo:${groupId}`,
    );

    return new Promise((resolve, reject) => {
      const messages: MessageStreamWorker[] = [];
      const timer = setTimeout(() => {
        this.off("message", onMessage);
        console.warn(
          `[${this.name}] Timeout. Got ${messages.length} / ${count} messages.`,
        );
        resolve(messages); // partial or empty
      }, timeoutMs);

      const onMessage = (msg: MessageStreamWorker) => {
        if (msg.type === "error") {
          clearTimeout(timer);
          this.off("message", onMessage);
          reject(new Error(`[${this.name}] Error: ${msg.message.content}`));
          return;
        }

        if (msg.type === "stream_message") {
          const { conversationId, contentType } = msg.message;
          const correctConversation = groupId === conversationId;
          const correctType = contentType?.typeId === typeId;

          if (correctConversation && correctType) {
            messages.push(msg);
            if (messages.length >= count) {
              clearTimeout(timer);
              this.off("message", onMessage);
              resolve(messages);
            }
          }
        }
      };

      this.on("message", onMessage);
    });
  }
}
