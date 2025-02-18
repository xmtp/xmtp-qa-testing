import dotenv from "dotenv";
import { describe, it } from "vitest";
import { TsWorker } from "../helpers/worker";

dotenv.config();

const TIMEOUT = 20000;

describe("Parallel DM flows using worker threads", () => {
  it(
    "should deliver all messages concurrently",
    async () => {
      console.log("Starting test with timeout of", TIMEOUT / 1000, "seconds");

      // Replace Worker instantiation with TsWorker
      const aliceWorker = new TsWorker(
        new URL("../helpers/worker.ts", import.meta.url),
        {
          stderr: true,
          stdout: true,
        },
      );

      const bobWorker = new TsWorker(
        new URL("../helpers/worker.ts", import.meta.url),
        {
          stderr: true,
          stdout: true,
        },
      );
      // // Add stdout and stderr logging for Alice
      // aliceWorker.stdout.on("data", (data) => {
      //   console.log("Alice stdout:", data.toString());
      // });
      // aliceWorker.stderr.on("data", (data) => {
      //   console.error("Alice stderr:", data.toString());
      // });

      // // Add stdout and stderr logging for Bob
      // bobWorker.stdout.on("data", (data) => {
      //   console.log("Bob stdout:", data.toString());
      // });
      // bobWorker.stderr.on("data", (data) => {
      //   console.error("Bob stderr:", data.toString());
      // });

      // Initialize both workers with different names and parameters
      aliceWorker.postMessage({
        type: "initialize",
        name: "Alice",
        env: "dev", // or any environment you want
        version: "42", // or any version you want
        installationId: "a",
      });

      bobWorker.postMessage({
        type: "initialize",
        name: "Bob",
        env: "dev",
        version: "42",
        installationId: "a",
      });

      const aliceInitialized = new Promise<string>((resolve, reject) => {
        aliceWorker.on("message", (msg: any) => {
          if (msg.type === "clientInitialized") {
            resolve(msg.clientAddress);
          } else if (msg.type === "error") {
            reject(new Error(msg.error));
          }
        });
      });

      const bobInitialized = new Promise<string>((resolve, reject) => {
        bobWorker.on("message", (msg: any) => {
          if (msg.type === "clientInitialized") {
            resolve(msg.clientAddress);
          } else if (msg.type === "error") {
            reject(new Error(msg.error));
          }
        });
      });

      // Set up message listeners before sending
      const messageHandler = new Promise<{ sent?: string; received?: string }>(
        (resolve, reject) => {
          let messageSent = false;
          let messageReceived = false;

          aliceWorker.on("message", (msg: any) => {
            if (msg.type === "messageReceived") {
              messageReceived = true;
              if (messageSent) {
                resolve({ sent: msg.message, received: msg.message });
              }
            } else if (msg.type === "error") {
              reject(new Error(msg.error));
            }
          });

          bobWorker.on("message", (msg: any) => {
            if (msg.type === "messageSent") {
              messageSent = true;
              if (messageReceived) {
                resolve({ sent: msg.message, received: msg.message });
              }
            } else if (msg.type === "error") {
              reject(new Error(msg.error));
            }
          });
        },
      );

      try {
        console.log("Waiting for workers to initialize...");
        const [aliceAddress, bobAddress] = await Promise.all([
          aliceInitialized,
          bobInitialized,
        ]);

        console.log(
          "Alice initialized successfully with address:",
          aliceAddress,
        );
        console.log("Bob initialized successfully with address:", bobAddress);

        const gmMessage = "gm-" + Math.random().toString(36).substring(2, 15);

        // Start Alice listening before Bob sends
        aliceWorker.postMessage({
          type: "receiveMessage",
          senderAddress: bobAddress,
          expectedMessage: gmMessage,
        });

        // Add a small delay to ensure the stream is ready
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Tell Bob to send message to Alice
        bobWorker.postMessage({
          type: "sendMessage",
          recipientAddress: aliceAddress,
          message: gmMessage,
        });

        // Wait for both operations to complete
        const result = await messageHandler;
        console.log("Message exchange complete:", result);
      } catch (error) {
        console.error("Failed during message exchange:", error);
        throw error;
      }
    },
    TIMEOUT,
  );
});
