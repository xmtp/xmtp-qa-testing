import { createAgent } from "@agents/factory";
import type { AgentManager } from "@agents/manager";
import { closeEnv, loadEnv } from "@helpers/client";
import { sendDeliveryMetric, sendTestResults } from "@helpers/datadog";
import { logError } from "@helpers/tests";
import {
  defaultValues,
  type Group,
  type VerifyStreamResult,
} from "@helpers/types";
import {
  calculateMessageStats,
  getAgentsFromGroup,
  verifyStream,
} from "@helpers/verify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testName = "ts_delivery";
loadEnv(testName);

const amountofMessages = parseInt(
  process.env.CLI_DELIVERY_AMOUNT ?? process.env.DELIVERY_AMOUNT ?? "10",
);
const receiverAmount = parseInt(
  process.env.CLI_DELIVERY_RECEIVERS ?? process.env.DELIVERY_RECEIVERS ?? "4",
);

console.log(
  `[${testName}] Amount of messages: ${amountofMessages}, Receivers: ${receiverAmount}`,
);
// 2 seconds per message, multiplied by the total number of participants
// valiable for github actions
const timeoutMax =
  amountofMessages * receiverAmount * defaultValues.perMessageTimeout;

describe(
  testName,
  () => {
    let agents: AgentManager;
    let group: Group;
    let collectedMessages: VerifyStreamResult;
    const randomSuffix = Math.random().toString(36).substring(2, 15);
    let hasFailures = false;
    beforeAll(async () => {
      try {
        //fs.rmSync(".data", { recursive: true, force: true });
        // Use createAgent to spin up many personas. This is resource-intensive.
        agents = await createAgent(receiverAmount, testName);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log("creating group");
        group = await agents
          .get("bob")!
          .client.conversations.newGroup([
            ...agents.getAgents().map((p) => p.client.inboxId),
          ]);

        expect(group).toBeDefined();
        expect(agents.getAgents().length).toBe(receiverAmount);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });

    afterAll(async () => {
      try {
        sendTestResults(hasFailures ? "failure" : "success", testName);
        await closeEnv(testName, agents);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });

    it("tc_stream: send the stream", async () => {
      try {
        expect(group.id).toBeDefined();

        // Collect messages by setting up listeners before sending and then sending known messages.
        collectedMessages = await verifyStream(
          group,
          agents.getAgents(),
          "text",
          amountofMessages,
          (index) => `gm-${index + 1}-${randomSuffix}`,
        );
        expect(collectedMessages.allReceived).toBe(true);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });

    it("tc_stream_order: verify message order when receiving via streams", () => {
      try {
        // Group messages by persona
        const messagesByPersona: string[][] = [];

        // Normalize the collectedMessages structure to match the pull test
        for (let i = 0; i < collectedMessages.messages.length; i++) {
          messagesByPersona.push(collectedMessages.messages[i]);
        }

        const stats = calculateMessageStats(
          messagesByPersona,
          "gm-",
          amountofMessages,
          randomSuffix,
        );

        // We expect all messages to be received and in order
        expect(stats.receptionPercentage).toBeGreaterThan(95);
        expect(stats.orderPercentage).toBeGreaterThan(95);

        sendDeliveryMetric(
          stats.receptionPercentage,
          agents.get("bob")!.version,
          testName,
          "stream",
          "delivery",
        );
        sendDeliveryMetric(
          stats.orderPercentage,
          agents.get("bob")!.version,
          testName,
          "stream",
          "order",
        );
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });

    it("tc_poll_order: verify message order when receiving via pull", async () => {
      try {
        const agentsFromGroup = await getAgentsFromGroup(group, agents);
        const messagesByPersona: string[][] = [];

        for (const agent of agentsFromGroup) {
          const conversation =
            await agent.client.conversations.getConversationById(group.id);
          if (!conversation) {
            throw new Error("Conversation not found");
          }
          const messages = await conversation.messages();
          const filteredMessages: string[] = [];

          for (const message of messages) {
            if (
              message.contentType?.typeId === "text" &&
              (message.content as string).includes(randomSuffix)
            ) {
              filteredMessages.push(message.content as string);
            }
          }

          messagesByPersona.push(filteredMessages);
        }

        const stats = calculateMessageStats(
          messagesByPersona,
          "gm-",
          amountofMessages,
          randomSuffix,
        );

        // We expect all messages to be received and in order
        expect(stats.receptionPercentage).toBeGreaterThan(95);
        expect(stats.orderPercentage).toBeGreaterThan(95); // At least some personas should have correct order

        sendDeliveryMetric(
          stats.receptionPercentage,
          agents.get("bob")!.version,
          testName,
          "poll",
          "delivery",
        );
        sendDeliveryMetric(
          stats.orderPercentage,
          agents.get("bob")!.version,
          testName,
          "poll",
          "order",
        );
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });

    it("tc_offline_recovery: verify message recovery after disconnection", async () => {
      try {
        // Select one persona to take offline
        const offlinePersona = agents.get("bob")!; // Second persona
        const onlinePersona = agents.get("alice")!; // First persona

        console.log(`Taking ${offlinePersona.name} offline`);

        // Disconnect the selected persona
        await offlinePersona.worker.terminate();

        // Send messages from an online persona
        const conversation =
          await onlinePersona.client.conversations.getConversationById(
            group.id,
          );

        console.log(
          `Sending ${amountofMessages} messages while client is offline`,
        );
        for (let i = 0; i < amountofMessages; i++) {
          const message = `offline-msg-${i + 1}-${randomSuffix}`;
          await conversation!.send(message);
          console.log(`Sent message ${message}`);
        }

        // Reconnect the offline persona
        console.log(`Reconnecting ${offlinePersona.name}`);
        const { client } = await offlinePersona.worker.initialize();
        offlinePersona.client = client;
        await offlinePersona.client.conversations.sync();

        // Verify message recovery
        const recoveredConversation =
          await offlinePersona.client.conversations.getConversationById(
            group.id,
          );
        await recoveredConversation?.sync();
        const messages = await recoveredConversation?.messages();

        const messagesByPersona: string[][] = [];
        const recoveredMessages: string[] = [];
        for (const message of messages ?? []) {
          if (
            message.content &&
            typeof message.content === "string" &&
            message.content.includes(`offline-msg-`) &&
            message.content.includes(randomSuffix)
          ) {
            recoveredMessages.push(message.content);
          }
        }

        messagesByPersona.push(recoveredMessages);

        const stats = calculateMessageStats(
          messagesByPersona,
          "offline-msg-",
          amountofMessages,
          randomSuffix,
        );

        // We expect all messages to be received and in order
        expect(stats.receptionPercentage).toBeGreaterThan(95);
        expect(stats.orderPercentage).toBeGreaterThan(95); // At least some personas should have correct order

        sendDeliveryMetric(
          stats.receptionPercentage,
          offlinePersona.version,
          testName,
          "offline",
          "delivery",
        );
        sendDeliveryMetric(
          stats.orderPercentage,
          offlinePersona.version,
          testName,
          "offline",
          "order",
        );
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
  },
  timeoutMax,
);
