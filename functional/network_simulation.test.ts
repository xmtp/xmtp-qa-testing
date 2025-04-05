import { loadEnv } from "@helpers/client";
import { logError } from "@helpers/logger";
import type { Conversation, XmtpEnv } from "@helpers/types";
import type { WorkerClient } from "@workers/main";
import { getWorkers, type NetworkConditions } from "@workers/manager";
import { describe, expect, it } from "vitest";

const users: {
  [key: string]: {
    inboxId: string;
    env: string;
  };
} = {
  convos: {
    inboxId: "7b7eefbfb80e019656b6566101d6903ec8cf5494e2d6ae5ef0a4c4c886d86a47",
    env: "dev",
  },
};

const testName = "network_simulation";
loadEnv(testName);

const workerConfigs = [
  { name: "bob", id: "a", number: "100" },
  { name: "alice", id: "b", number: "104" },
];

// Network condition presets for testing
const networkConditions: Record<string, NetworkConditions> = {
  highLatency: { latencyMs: 1000, jitterMs: 200 },
  packetLoss: { packetLossRate: 0.3 },
  disconnection: { disconnectProbability: 0.2, disconnectDurationMs: 5000 },
  bandwidthLimit: { bandwidthLimitKbps: 100 },
  poorConnection: {
    latencyMs: 500,
    jitterMs: 100,
    packetLossRate: 0.1,
    bandwidthLimitKbps: 200,
  },
};

describe(testName, () => {
  let groupId: string;
  let workerInstances: Record<string, WorkerClient> = {};

  for (const user of Object.keys(users)) {
    describe(`User: ${user} [${users[user].env}]`, () => {
      const receiver = users[user].inboxId;

      it("should initialize workers and create test group", async () => {
        try {
          console.log(
            `Setting up network simulation test for ${user}[${users[user].env}]`,
          );

          // Create workers
          const workers = await getWorkers(
            workerConfigs.map((w) => `${w.name}-${w.id}-${w.number}`),
            testName,
            "message",
            false,
            undefined,
            users[user].env as XmtpEnv,
          );

          // Store worker instances
          workerConfigs.forEach((w) => {
            const worker = workers.get(w.name, w.id);
            if (!worker) {
              throw new Error(`Worker ${w.name} not found`);
            }
            workerInstances[w.name] = worker as unknown as WorkerClient;
          });

          // Apply initial network conditions
          workers.setWorkerNetworkConditions(
            workerConfigs[0].name,
            networkConditions.highLatency,
          );
          workers.setWorkerNetworkConditions(
            workerConfigs[1].name,
            networkConditions.packetLoss,
          );

          // Sync conversations
          await Promise.all(
            workerConfigs.map((w) => {
              const worker = workerInstances[w.name] as {
                client?: { conversations?: { sync: () => Promise<void> } };
              };
              return worker?.client?.conversations?.sync();
            }),
          );

          // Create group with receiver
          const worker = workerInstances[workerConfigs[0].name] as {
            client?: {
              conversations?: {
                newGroup: (
                  inboxIds: string[],
                  options: {
                    groupName: string;
                    groupDescription: string;
                  },
                ) => Promise<Conversation>;
              };
            };
          };
          if (!worker.client?.conversations) {
            throw new Error("Worker client or conversations not available");
          }
          const group = await worker.client.conversations.newGroup([receiver], {
            groupName: "Network Test Group",
            groupDescription: "Group for network simulation testing",
          });
          groupId = group.id;
          console.log("Created group with ID:", groupId);
        } catch (e) {
          logError(e, expect);
          throw e;
        }
      });

      it("should test various network conditions", async () => {
        try {
          // Test cases with different network conditions
          const testCases = [
            {
              name: "high latency and packet loss",
              workers: [0, 1],
              conditions: [
                { worker: 0, condition: networkConditions.highLatency },
                { worker: 1, condition: networkConditions.packetLoss },
              ],
              message: "Message with high latency and packet loss",
              waitTime: 5000,
            },
            {
              name: "disconnection",
              workers: [0, 1],
              conditions: [
                { worker: 0, condition: networkConditions.disconnection },
                { worker: 1, condition: networkConditions.disconnection },
              ],
              message: "Message with disconnection simulation",
              waitTime: 10000,
            },
            {
              name: "bandwidth limitation",
              workers: [0],
              conditions: [
                { worker: 0, condition: networkConditions.bandwidthLimit },
              ],
              message: "Message with bandwidth limitation",
              waitTime: 5000,
            },
            {
              name: "poor connection",
              workers: [1],
              conditions: [
                { worker: 1, condition: networkConditions.poorConnection },
              ],
              message: "Message with poor connection simulation",
              waitTime: 5000,
            },
          ];

          // Run each test case
          for (const testCase of testCases) {
            console.log(`Testing ${testCase.name}`);

            // Get workers for this test case
            const workers = await getWorkers(
              testCase.workers.map(
                (i) =>
                  `${workerConfigs[i].name}-${workerConfigs[i].id}-${workerConfigs[i].number}`,
              ),
              testName,
              "message",
              false,
              undefined,
              users[user].env as XmtpEnv,
            );

            // Apply network conditions
            testCase.conditions.forEach(({ worker, condition }) => {
              workers.setWorkerNetworkConditions(
                workerConfigs[worker].name,
                condition,
              );
            });

            // Send message
            const worker = workerInstances[workerConfigs[0].name] as {
              client?: {
                conversations?: {
                  getConversationById: (id: string) => Promise<Conversation>;
                };
              };
            };
            if (!worker.client?.conversations) {
              throw new Error("Worker client or conversations not available");
            }
            const group =
              await worker.client.conversations.getConversationById(groupId);
            await group?.send(testCase.message);

            // Wait for operations to complete
            await new Promise((resolve) =>
              setTimeout(resolve, testCase.waitTime),
            );
          }
        } catch (e) {
          logError(e, expect);
          throw e;
        }
      });
    });
  }
});
