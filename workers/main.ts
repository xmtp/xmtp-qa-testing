import fs from "node:fs";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import {
  createSigner,
  getDbPath,
  getEncryptionKeyFromHex,
} from "@helpers/client";
import {
  Client,
  defaultValues,
  Dm,
  sdkVersions,
  type Consent,
  type Conversation,
  type DecodedMessage,
  type LogLevel,
  type typeofStream,
  type XmtpEnv,
} from "@helpers/types";
import OpenAI from "openai";
import type { NetworkConditions, WorkerBase } from "./manager";

// Unified worker message types
export type WorkerMessageBase = {
  type: string;
};

export type MessageStreamWorker = WorkerMessageBase & {
  type: "stream_message";
  message: DecodedMessage;
};

export type ConversationStreamWorker = WorkerMessageBase & {
  type: "stream_conversation";
  conversation: Conversation;
};

export type ConsentStreamWorker = WorkerMessageBase & {
  type: "stream_consent";
  consentUpdate: Consent[] | undefined;
};

export type WorkerMessage =
  | MessageStreamWorker
  | ConversationStreamWorker
  | ConsentStreamWorker;

// Worker thread code as a string
const workerThreadCode = `
import { parentPort, workerData } from "node:worker_threads";
import type { Client } from "@helpers/types";

// The Worker must be run in a worker thread, so confirm \`parentPort\` is defined
if (!parentPort) {
  throw new Error("This module must be run as a worker thread");
}

// Optional logs to see what's being passed into the worker.
console.log("[Worker] Started with workerData:", workerData);

// Listen for messages from the parent
parentPort.on("message", (message: { type: string; data: any }) => {
  switch (message.type) {
    case "initialize":
      // You can add logs or do any one-time setup here.
      console.log("[Worker] Received 'initialize' message:", message.data);
      break;

    default:
      console.log(\`[Worker] Received unknown message type: \${message.type}\`);
      break;
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[Worker] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Worker] Uncaught Exception:", error);
});

// Re-export anything needed in the worker environment (if necessary)
export type { Client };
`;

// Bootstrap code that loads the worker thread code
const workerBootstrap = /* JavaScript */ `
  import { parentPort, workerData } from "node:worker_threads";
  
  // Execute the worker code
  const workerCode = ${JSON.stringify(workerThreadCode)};
  const workerModule = new Function('require', 'parentPort', 'workerData', 'process', workerCode);
  
  // Get the require function
  import { createRequire } from "node:module";
  import { fileURLToPath } from "node:url";
  const __filename = fileURLToPath("${import.meta.url}");
  const require = createRequire(__filename);
  
  // Execute the worker code
  workerModule(require, parentPort, workerData, process);
`;

export class WorkerClient extends Worker {
  public name: string;
  private testName: string;
  private nameId: string;
  private walletKey: string;
  private encryptionKeyHex: string;
  private typeofStream: typeofStream;
  private gptEnabled: boolean;
  private folder: string;
  private workerData: WorkerBase;
  public address!: `0x${string}`;
  public client!: Client;
  private env: XmtpEnv;
  // Stream management
  private activeStream?: AsyncIterable<any> & {
    return: (value?: any) => Promise<any>;
  };
  private isTerminated = false;

  // Network simulation properties
  private networkConditions?: NetworkConditions;
  private isDisconnected = false;
  private disconnectTimeout?: NodeJS.Timeout;
  private lastOperationTime = 0;
  private bandwidthUsage = 0;
  private bandwidthResetTime = 0;

  constructor(
    worker: WorkerBase,
    typeofStream: typeofStream,
    gptEnabled: boolean,
    env: XmtpEnv,
    options: WorkerOptions = {},
  ) {
    options.workerData = {
      worker,
    };

    super(new URL(`data:text/javascript,${workerBootstrap}`), options);

    this.gptEnabled = gptEnabled;
    this.typeofStream = typeofStream;
    this.name = worker.name;
    this.folder = worker.folder;
    this.env = env;
    this.nameId = worker.name;
    this.testName = worker.testName;
    this.walletKey = worker.walletKey;
    this.encryptionKeyHex = worker.encryptionKey;
    this.workerData = worker;
    this.networkConditions = worker.networkConditions;

    this.setupEventHandlers();
  }

  /**
   * Sets network conditions for this worker
   * @param conditions The network conditions to apply
   */
  public setNetworkConditions(conditions: NetworkConditions): void {
    this.networkConditions = conditions;
    console.log(`[${this.nameId}] Network conditions updated:`, conditions);
  }

  /**
   * Simulates network conditions for an operation
   * @param operation The operation to perform
   * @returns The result of the operation
   */
  private async simulateNetworkConditions<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.networkConditions) {
      return operation();
    }

    // Simulate disconnection
    if (
      this.networkConditions.disconnectProbability &&
      Math.random() < this.networkConditions.disconnectProbability &&
      !this.isDisconnected
    ) {
      this.isDisconnected = true;
      const duration = this.networkConditions.disconnectDurationMs ?? 5000;

      console.log(`[${this.nameId}] Network disconnected for ${duration}ms`);

      this.disconnectTimeout = setTimeout(() => {
        this.isDisconnected = false;
        console.log(`[${this.nameId}] Network reconnected`);
      }, duration);

      throw new Error(`Network disconnected for ${duration}ms`);
    }

    // Simulate packet loss
    if (
      this.networkConditions.packetLossRate &&
      Math.random() < this.networkConditions.packetLossRate
    ) {
      console.log(`[${this.nameId}] Packet lost`);
      throw new Error("Packet lost");
    }

    // Simulate bandwidth limit
    if (this.networkConditions.bandwidthLimitKbps) {
      const now = Date.now();
      const bandwidthLimitBytes =
        (this.networkConditions.bandwidthLimitKbps * 1024) / 8;

      // Reset bandwidth usage counter every second
      if (now - this.bandwidthResetTime > 1000) {
        this.bandwidthUsage = 0;
        this.bandwidthResetTime = now;
      }

      // Estimate operation size (rough approximation)
      const estimatedSize = 1024; // Assume 1KB per operation

      if (this.bandwidthUsage + estimatedSize > bandwidthLimitBytes) {
        const waitTime = 1000 - (now - this.bandwidthResetTime);
        console.log(
          `[${this.nameId}] Bandwidth limit reached, waiting ${waitTime}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        this.bandwidthUsage = 0;
        this.bandwidthResetTime = Date.now();
      }

      this.bandwidthUsage += estimatedSize;
    }

    // Simulate latency and jitter
    if (this.networkConditions.latencyMs || this.networkConditions.jitterMs) {
      const baseLatency = this.networkConditions.latencyMs ?? 0;
      const jitter = this.networkConditions.jitterMs
        ? (Math.random() * 2 - 1) * (this.networkConditions.jitterMs ?? 0)
        : 0;

      const totalLatency = Math.max(0, baseLatency + jitter);

      if (totalLatency > 0) {
        console.log(
          `[${this.nameId}] Adding latency: ${totalLatency.toFixed(2)}ms`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.floor(totalLatency)),
        );
      }
    }

    return operation();
  }

  private setupEventHandlers() {
    // Log messages from the Worker
    this.on("message", (message) => {
      console.log(`[${this.nameId}] Worker message:`, message);
    });

    // Handle Worker errors
    this.on("error", (error) => {
      console.error(`[${this.nameId}] Worker error:`, error);
    });

    // Handle Worker exit
    this.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[${this.nameId}] Worker stopped with exit code ${code}`);
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
    installationId: string;
    address: `0x${string}`;
  }> {
    return this.simulateNetworkConditions(async () => {
      // Tell the Worker to do any internal initialization
      this.postMessage({
        type: "initialize",
        data: {
          name: this.name,
          folder: this.folder,
        },
      });

      const signer = createSigner(this.walletKey as `0x${string}`);
      const encryptionKey = getEncryptionKeyFromHex(this.encryptionKeyHex);

      // Get the SDK version from the worker data
      const sdkVersion = this.workerData.sdkVersion;
      // Select the appropriate SDK client based on version
      let ClientClass;
      if (sdkVersion) {
        ClientClass = sdkVersions[sdkVersion as "100" | "104" | "105"].Client;
      } else {
        ClientClass = Client;
      }

      if (!ClientClass) {
        throw new Error(`Unsupported SDK version: ${sdkVersion}`);
      }

      // Force version to include the SDK version for easier identification
      const sdkIdentifier = sdkVersion || "latest";
      const libXmtpVersion =
        ClientClass.version.split("@")[1].split(" ")[0] ?? "unknown";

      const version = `${libXmtpVersion}-${sdkIdentifier}`;

      const identifier = await signer.getIdentifier();
      this.address = identifier.identifier as `0x${string}`;
      const loggingLevel = process.env.LOGGING_LEVEL as LogLevel;
      const dbPath = getDbPath(
        this.name,
        this.address,
        this.testName,
        this.folder,
        version,
        this.env,
      );

      // @ts-expect-error Window localStorage access in browser context
      this.client = await ClientClass.create(signer, encryptionKey, {
        dbPath,
        env: this.env,
        loggingLevel: loggingLevel,
      });

      // Start the appropriate stream based on configuration
      await this.startStream();

      const installationId = this.client.installationId;

      return {
        client: this.client,
        dbPath,
        version,
        address: this.address,
        installationId,
      };
    });
  }

  /**
   * Unified method to start the appropriate stream based on configuration
   */
  private async startStream() {
    if (!this.typeofStream || this.typeofStream === "none") {
      console.log(`[${this.nameId}] No stream requested`);
      return;
    }

    try {
      switch (this.typeofStream) {
        case "message":
          await this.initMessageStream();
          break;
        case "conversation":
          await this.initConversationStream();
          break;
        case "consent":
          this.initConsentStream();
          break;
        default:
          console.log(`[${this.nameId}] Unsupported stream type`);
          return;
      }
    } catch (error) {
      console.error(
        `[${this.nameId}] Failed to start ${this.typeofStream} stream:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Initialize and handle message stream
   */
  private async initMessageStream() {
    this.activeStream = await this.simulateNetworkConditions(async () => {
      return this.client.conversations.streamAllMessages();
    });

    // Process messages asynchronously
    void (async () => {
      try {
        if (!this.activeStream) return;

        for await (const message of this.activeStream) {
          if (this.isTerminated) break;

          // Skip messages from self
          if (
            message?.senderInboxId.toLowerCase() ===
            this.client.inboxId.toLowerCase()
          ) {
            continue;
          }

          // Check for GPT response triggers
          if (this.shouldGenerateGptResponse(message as DecodedMessage)) {
            await this.handleGptResponse(message as DecodedMessage);
            continue;
          }

          console.time(`[${this.nameId}] Process message`);

          const workerMessage: MessageStreamWorker = {
            type: "stream_message",
            message: message as DecodedMessage,
          };

          // Emit if any listeners are attached
          if (this.listenerCount("message") > 0) {
            this.emit("message", workerMessage);
          }

          console.timeEnd(`[${this.nameId}] Process message`);
        }
      } catch (error) {
        if (!this.isTerminated) {
          console.error(`[${this.nameId}] Stream error:`, error);
          this.emit("error", error);
        }
      }
    })();
  }

  /**
   * Check if a message should trigger a GPT response
   */
  private shouldGenerateGptResponse(message: DecodedMessage): boolean {
    if (!this.gptEnabled) return false;
    const conversation = this.client.conversations.getConversationById(
      message.conversationId,
    );
    // Get the base name without installation ID
    const baseName = this.name.split("-")[0].toLowerCase();
    const isDm = conversation instanceof Dm;
    return ((message?.contentType?.typeId === "text" &&
      message.content.includes(baseName) &&
      !message.content.includes("/") &&
      !message.content.includes("workers") &&
      !message.content.includes("members") &&
      !message.content.includes("admins")) ||
      isDm) as boolean;
  }

  /**
   * Handle generating and sending GPT responses
   */
  private async handleGptResponse(message: DecodedMessage) {
    console.time(`[${this.nameId}] GPT Agent: Response`);

    try {
      // Get the conversation from the message
      const conversation = await this.client.conversations.getConversationById(
        message.conversationId,
      );

      const messages = await conversation?.messages();
      const baseName = this.name.split("-")[0].toLowerCase();

      // Generate a response using OpenAI
      const response = await this.generateOpenAIResponse(
        message.content as string,
        messages ?? [],
        baseName,
      );

      console.log(`[${this.nameId}] GPT Agent: Response: "${response}"`);

      // Send the response
      await conversation?.send(response);
    } catch (error) {
      console.error(`[${this.nameId}] Error generating GPT response:`, error);
    } finally {
      console.timeEnd(`[${this.nameId}] GPT Agent: Response`);
    }
  }

  /**
   * Initialize and handle conversation stream
   */
  private async initConversationStream() {
    // Track initial conversations to avoid duplicates
    const initialConversations = await this.client.conversations.list();
    const knownConversations = new Set(initialConversations.map((c) => c.id));

    console.log(
      `[${this.nameId}] Initial conversations count: ${knownConversations.size}`,
    );

    // Use the stream method to listen for conversation updates
    this.activeStream = this.client.conversations.stream();

    // Process conversations asynchronously
    void (async () => {
      try {
        if (!this.activeStream) return;

        for await (const conversation of this.activeStream) {
          if (this.isTerminated) break;

          const convoId = conversation?.id;

          if (!convoId) {
            console.error(`[${this.nameId}] Conversation ID is undefined`);
            continue;
          }

          // Only emit for new conversations that weren't in our initial set
          if (!knownConversations.has(convoId as string)) {
            console.log(
              `[${this.nameId}] New conversation in stream: ${convoId}`,
            );

            // Add to known conversations
            knownConversations.add(convoId as string);

            // Create and emit the worker message
            const workerMessage: ConversationStreamWorker = {
              type: "stream_conversation",
              conversation: conversation,
            };

            // Emit if any listeners are attached
            if (this.listenerCount("message") > 0) {
              this.emit("message", workerMessage);
            }
          }
        }
      } catch (error) {
        if (!this.isTerminated) {
          console.error(`[${this.nameId}] Conversation stream error:`, error);
          this.emit("error", error);
        }
      }
    })();
  }

  /**
   * Initialize and handle consent stream
   */
  private initConsentStream() {
    // Use the stream method to listen for consent updates
    this.activeStream = this.client.preferences.streamConsent();

    // Process consent updates asynchronously
    void (async () => {
      try {
        if (!this.activeStream) return;

        for await (const consentUpdate of this.activeStream) {
          if (this.isTerminated) break;

          // Create and emit the worker message
          const workerMessage: ConsentStreamWorker = {
            type: "stream_consent",
            consentUpdate: consentUpdate,
          };

          // Emit if any listeners are attached
          if (this.listenerCount("message") > 0) {
            this.emit("message", workerMessage);
          }
        }
      } catch (error) {
        if (!this.isTerminated) {
          console.error(`[${this.nameId}] Consent stream error:`, error);
          this.emit("error", error);
        }
      }
    })();
  }

  /**
   * Unified method to collect stream events
   * @param options Configuration for collection
   * @returns Promise resolving with an array of WorkerMessage
   */
  collectStreamEvents<T extends WorkerMessage>(options: {
    type: "message" | "conversation" | "consent";
    filterFn?: (msg: WorkerMessage) => boolean;
    count: number;
    timeoutMs?: number;
    additionalInfo?: Record<string, any>;
  }): Promise<T[]> {
    const {
      type,
      filterFn,
      count,
      timeoutMs = count * defaultValues.perMessageTimeout,
      additionalInfo = {},
    } = options;

    const typeLabel =
      type === "message"
        ? "messages"
        : type === "conversation"
          ? "conversations"
          : "consent updates";

    const filterInfo = Object.entries(additionalInfo)
      .map(([key, value]) => `${key}:${value}`)
      .join(", ");

    console.log(
      `[${this.nameId}] Collecting ${count} ${typeLabel}${filterInfo ? ` (${filterInfo})` : ""}`,
    );

    return new Promise((resolve) => {
      const events: T[] = [];
      const timer = setTimeout(() => {
        this.off("message", onMessage);
        console.warn(
          `[${this.nameId}] Timeout. Got ${events.length} / ${count} ${typeLabel}.`,
        );
        resolve(events); // partial or empty
      }, timeoutMs);

      const onMessage = (msg: WorkerMessage) => {
        // Check if this is the right type of message
        const isRightType = msg.type === `stream_${type}`;

        // Apply additional filter if provided
        const passesFilter = !filterFn || filterFn(msg);

        if (isRightType && passesFilter) {
          let logContent = "";
          if (type === "message") {
            logContent = (msg as MessageStreamWorker).message.content as string;
          } else if (type === "conversation") {
            logContent = (msg as ConversationStreamWorker).conversation.id;
          } else {
            logContent = JSON.stringify(
              (msg as ConsentStreamWorker).consentUpdate,
            );
          }

          if (!this.testName.includes("ts")) {
            console.log(`[${this.nameId}] Received ${type}: ${logContent}`);
          }

          events.push(msg as T);
          if (events.length >= count) {
            clearTimeout(timer);
            this.off("message", onMessage);
            resolve(events);
          }
        }
      };

      this.on("message", onMessage);
    });
  }

  /**
   * Collect messages with specific criteria
   */
  collectMessages(
    groupId: string,
    typeId: string,
    count: number,
    timeoutMs = count * defaultValues.perMessageTimeout,
  ): Promise<MessageStreamWorker[]> {
    return this.collectStreamEvents<MessageStreamWorker>({
      type: "message",
      filterFn: (msg) => {
        if (msg.type !== "stream_message") return false;
        const messageMsg = msg;
        const { conversationId, contentType } = messageMsg.message;
        return groupId === conversationId && contentType?.typeId === typeId;
      },
      count,
      timeoutMs,
      additionalInfo: { groupId, contentType: typeId },
    });
  }

  /**
   * Collect conversations
   */
  collectConversations(
    fromPeerAddress: string,
    count: number = 1,
    timeoutMs = count * defaultValues.perMessageTimeout,
  ): Promise<ConversationStreamWorker[]> {
    return this.collectStreamEvents<ConversationStreamWorker>({
      type: "conversation",
      count,
      timeoutMs,
      additionalInfo: { fromPeerAddress },
    });
  }

  /**
   * Collect consent updates
   */
  collectConsentUpdates(
    count: number = 1,
    timeoutMs = count * defaultValues.timeout,
  ): Promise<ConsentStreamWorker[]> {
    return this.collectStreamEvents<ConsentStreamWorker>({
      type: "consent",
      count,
      timeoutMs,
    });
  }

  /**
   * Clean up resources on termination
   */
  async terminate() {
    if (this.isTerminated) {
      return super.terminate(); // Already terminated, just call parent
    }

    console.time(`[${this.nameId}] Terminate stream`);
    try {
      if (this.activeStream && typeof this.activeStream.return === "function") {
        await this.activeStream.return();
        this.isTerminated = true;
        //console.warn(`[${this.nameId}] Terminated stream`);
      }
    } catch (error) {
      console.error(`[${this.nameId}] Error during stream cleanup:`, error);
    }
    console.timeEnd(`[${this.nameId}] Terminate stream`);

    // Call parent terminate
    return super.terminate();
  }

  /**
   * Generates a response using OpenAI based on the message content.
   */
  private async generateOpenAIResponse(
    message: string,
    history: DecodedMessage[],
    workerName: string,
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log(
      `[${this.nameId}] Generating OpenAI response for message: ${message}`,
    );

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are ${workerName}, a fake worker in a group chat. 
                     Keep your responses concise (under 100 words) and friendly. 
                     Never mention other workers in your responses. Never answer more than 1 question per response.
                     For context, these were the last 10 messages in the conversation: ${history
                       ?.slice(0, 10)
                       .map((m) => m.content as string)
                       .join("\n")}`,
        },
        { role: "user", content: message },
      ],
      model: "gpt-4o-mini",
    });

    return (
      workerName +
      ":\n" +
      (completion.choices[0]?.message?.content ||
        "I'm not sure how to respond to that.")
    );
  }

  /**
   * Clears the database for this worker
   * @returns true if the database was cleared, false otherwise
   */
  clearDB(): Promise<boolean> {
    const dataPath = path.resolve(process.cwd(), ".data/" + this.name);
    if (fs.existsSync(dataPath)) {
      fs.rmSync(dataPath, { recursive: true, force: true });
    }
    return Promise.resolve(true);
  }
}
