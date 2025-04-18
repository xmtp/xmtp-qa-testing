import { loadEnv } from "@helpers/client";
import { XmtpPlaywright } from "@helpers/playwright";
import { describe, expect, it } from "vitest";

const testName = "browser";
loadEnv(testName);

const gmBotAddress = process.env.GM_BOT_ADDRESS as string;
describe(testName, () => {
  const xmtpTester = new XmtpPlaywright(true, "dev");

  it("should respond to a message", async () => {
    console.log("sending gm to bot", gmBotAddress);
    const result = await xmtpTester.newDmWithDeeplink(gmBotAddress);
    expect(result).toBe(true);
  });

  // it("should create a group and send a message", async () => {
  //   try {
  //     const slicedInboxes = generatedInboxes.slice(0, 4);
  //     await xmtpTester.createGroupAndReceiveGm([
  //       ...slicedInboxes.map((inbox) => inbox.accountAddress),
  //       gmBotAddress,
  //     ]);
  //   } catch (e) {
  //     logError(e, expect);
  //     throw e;
  //   }
  // });
});
