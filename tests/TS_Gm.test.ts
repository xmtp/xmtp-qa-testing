import { createAgent } from "@agents/factory";
import type { AgentManager } from "@agents/manager";
import { closeEnv, loadEnv } from "@helpers/client";
import { sendTestResults } from "@helpers/datadog";
import generatedInboxes from "@helpers/generated-inboxes.json";
import { createGroupAndReceiveGm } from "@helpers/playwright";
import { logError } from "@helpers/tests";
import { IdentifierKind, type Conversation } from "@helpers/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testName = "ts_gm";
loadEnv(testName);

const gmBotAddress = process.env.GM_BOT_ADDRESS as string;

describe(testName, () => {
  let convo: Conversation;
  let agents: AgentManager;
  let hasFailures: boolean = false;

  beforeAll(async () => {
    try {
      agents = await createAgent(["bob"], testName);
      expect(agents).toBeDefined();
      expect(agents.getAgents().length).toBe(1);
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

  it("gm-bot: should check if bot is alive", async () => {
    try {
      // Create conversation with the bot
      convo = await agents.get("bob")!.client.conversations.newDmByIdentifier({
        identifierKind: IdentifierKind.Ethereum,
        identifier: gmBotAddress,
      });

      await convo.sync();
      const prevMessages = (await convo.messages()).length;

      // Send a simple message
      await convo.send("gm");

      // Wait briefly for response
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const messages = await convo.messages();

      const messagesAfter = messages.length;

      // We should have at least 2 messages (our message and bot's response)
      expect(messagesAfter).toBe(prevMessages + 2);
      console.log("Messages before:", prevMessages, "after:", messagesAfter);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  it("should respond to a message", async () => {
    try {
      const result = await createGroupAndReceiveGm([gmBotAddress]);
      expect(result).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("should create a group and send a message", async () => {
    try {
      const randomInboxes = [...generatedInboxes].slice(0, 3);
      const result = await createGroupAndReceiveGm([
        ...randomInboxes.map((inbox) => inbox.accountAddress),
        gmBotAddress,
      ]);
      expect(result).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
});
