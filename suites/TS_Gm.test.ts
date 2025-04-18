import { closeEnv, loadEnv } from "@helpers/client";
import { sendTestResults } from "@helpers/datadog";
import generatedInboxes from "@helpers/generated-inboxes.json";
import { logError } from "@helpers/logger";
import { XmtpPlaywright } from "@helpers/playwright";
import { getWorkers, type WorkerManager } from "@workers/manager";
import { IdentifierKind, type Conversation } from "@xmtp/node-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testName = "ts_gm";
loadEnv(testName);

const gmBotAddress = process.env.GM_BOT_ADDRESS as string;

describe(testName, () => {
  let convo: Conversation;
  let workers: WorkerManager;
  let hasFailures: boolean = false;

  beforeAll(async () => {
    try {
      workers = await getWorkers(["bob-a-105"], testName);
      expect(workers).toBeDefined();
      expect(workers.getWorkers().length).toBe(1);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  afterAll(async () => {
    try {
      sendTestResults(hasFailures, testName);
      await closeEnv(testName, workers);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  it("gm-bot: should check if bot is alive", async () => {
    try {
      // Create conversation with the bot
      convo = await workers
        .get("bob")!
        .client.conversations.newDmWithIdentifier({
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
      const xmtpTester = new XmtpPlaywright(false);
      const result = await xmtpTester.newDmWithDeeplink(gmBotAddress);
      expect(result).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("should create a group and send a message", async () => {
    try {
      const xmtpTester = new XmtpPlaywright(false);
      const slicedInboxes = generatedInboxes.slice(0, 4);
      await xmtpTester.createGroupAndReceiveGm([
        ...slicedInboxes.map((inbox) => inbox.accountAddress),
        gmBotAddress,
      ]);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
});
