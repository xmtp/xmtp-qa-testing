import { closeEnv, loadEnv } from "@helpers/client";
import { logError } from "@helpers/logger";
import type { XmtpEnv } from "@helpers/types";
import { getWorkers, type WorkerManager } from "@workers/manager";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const users: {
  [key: string]: {
    inboxId: string;
    env: string;
  };
} = {
  // cb: {
  //   inboxId: "705c87a99e87097ee2044aec0bdb4617634e015db73900453ad56a7da80157ff",
  //   env: "production",
  // },
  convos: {
    inboxId: "7b7eefbfb80e019656b6566101d6903ec8cf5494e2d6ae5ef0a4c4c886d86a47",
    env: "dev",
  },
  // xmtpchat: {
  //   inboxId: "14b8fcaf1e5df82fd7f27d039b641d34116c440e964f313cf87cffb0e84e0105",
  //   env: "dev",
  // },
};

const testName = "bug_stitch";
loadEnv(testName);

describe(testName, () => {
  let hasFailures = false;

  for (const user of Object.keys(users)) {
    describe(`User: ${user} [${users[user].env}]`, () => {
      let ivy100: any;
      let ivy104: any;
      const receiver = users[user].inboxId;

      it("should initialize clients and sync conversations", async () => {
        try {
          console.log(`Setting up test for ${user}[${users[user].env}]`);
          const workers = await getWorkers(
            ["ivy-a-100"],
            testName,
            "message",
            false,
            undefined,
            users[user].env as XmtpEnv,
          );
          ivy100 = workers.get("ivy", "a");
          console.log("syncing all");
          await ivy100?.client.conversations.sync();
        } catch (e) {
          hasFailures = logError(e, expect);
          throw e;
        }
      });

      it("should create new DM and group conversations", async () => {
        const sender = ivy100?.client;
        try {
          const newConvo = await sender.conversations.newDm(receiver);

          console.log("sending message");
          const message = "message 1/3\n" + "convoId: " + String(newConvo.id);
          await newConvo?.send(message);
        } catch (e) {
          hasFailures = logError(e, expect);
          throw e;
        }
      });
      it("terminate and restart", async () => {
        // Simulate termination and restart
        console.warn("Ivy terminates, deletes local data, and restarts");
        await ivy100?.worker.clearDB();
        await ivy100?.worker.initialize();
      });

      it("should create new DM and group conversations", async () => {
        const sender = ivy100?.client;
        try {
          const newConvo = await sender.conversations.newDm(receiver);

          console.log("sending message");
          const message = "message 2/3\n" + "convoId: " + String(newConvo.id);
          await newConvo?.send(message);
        } catch (e) {
          hasFailures = logError(e, expect);
          throw e;
        }
      });
      it("should initialize clients and sync conversations", async () => {
        try {
          console.log(`Setting up test for ${user}[${users[user].env}]`);
          const workers = await getWorkers(
            ["ivy-b-104"],
            testName,
            "message",
            false,
            undefined,
            users[user].env as XmtpEnv,
          );
          ivy104 = workers.get("ivy", "b");
          console.log("syncing all");
          await ivy104?.client.conversations.sync();
        } catch (e) {
          hasFailures = logError(e, expect);
          throw e;
        }
      });

      it("should create new DM and group conversations", async () => {
        const sender = ivy104?.client;
        try {
          const newConvo = await sender.conversations.newDm(receiver);

          console.log("sending message");
          const message = "message 3/3\n" + "convoId: " + String(newConvo.id);
          await newConvo?.send(message);
        } catch (e) {
          hasFailures = logError(e, expect);
          throw e;
        }
      });
    });
  }
});
