import { loadEnv } from "@helpers/client";
import { logError } from "@helpers/logger";
import {
  getRandomNetworkCondition,
  getRandomVersion,
  manualUsers,
} from "@helpers/tests";
import type { Worker, XmtpEnv } from "@helpers/types";
import { getWorkers } from "@workers/manager";
import type { Conversation, Group } from "@xmtp/node-sdk";
import { describe, expect, it } from "vitest";

const testName = "bug_fork";
loadEnv(testName);

// Define worker names and IDs
const workerNames = ["bob", "alice", "ivy"];
const workerIds = ["a", "b", "c"];
const groupId = "e9e49860cbe42ab160d9d9a3dbe363e4";

describe(testName, () => {
  let hasFailures = false;
  // Global variables for workers and group
  let globalGroup: Conversation | undefined;
  let bob: Worker;
  let alice: Worker;
  let ivy: Worker;
  let messageCount = 0;

  const numWorkers = 3; // Reduced number of workers

  // Function to send message from a worker with name and count
  const sendMessageWithCount = async (worker: Worker, name: string) => {
    if (!globalGroup) {
      throw new Error("Group is not set");
    }
    try {
      // Random sync operations before sending message
      const syncType = Math.floor(Math.random() * 3);
      if (syncType === 0) {
        console.log(`${name} performing sync before sending message`);
        await worker.client.conversations.sync();
      } else if (syncType === 1) {
        console.log(`${name} performing syncAll before sending message`);
        await worker.client.conversations.syncAll();
      }
      // If syncType is 2, no sync operation is performed

      messageCount++;
      const message = `${name} ${messageCount}`;
      console.log(
        `${name} sending message: "${message}" to group ${globalGroup.id}`,
      );
      await globalGroup.send(message);
      return true;
    } catch (e) {
      console.error(`Error sending message from ${name}:`, e);
      return false;
    }
  };

  it("should initialize all workers at once and create group", async () => {
    try {
      // Create worker configs for all workers with random versions
      const workerConfigs = [];

      for (let i = 0; i < numWorkers; i++) {
        const workerName = workerNames[i];
        const workerId = workerIds[i];
        const workerVersion = getRandomVersion();
        console.log(`${workerName} using version: ${workerVersion}`);

        workerConfigs.push(`${workerName}-${workerId}-${workerVersion}`);
      }

      console.log("Creating all workers with configs:", workerConfigs);

      const workers = await getWorkers(
        workerConfigs,
        testName,
        "message",
        false,
        undefined,
        process.env.XMTP_ENV as XmtpEnv,
      );

      // Store worker instances in individual variables
      bob = workers.get("bob", "a") as Worker;
      alice = workers.get("alice", "b") as Worker;
      ivy = workers.get("ivy", "c") as Worker;

      // // Apply random network conditions to each worker
      // const bobCondition = getRandomNetworkCondition();
      // const aliceCondition = getRandomNetworkCondition();
      // const ivyCondition = getRandomNetworkCondition();

      // console.log("Applying network conditions:");
      // console.log(`Bob: ${JSON.stringify(bobCondition)}`);
      // console.log(`Alice: ${JSON.stringify(aliceCondition)}`);
      // console.log(`Ivy: ${JSON.stringify(ivyCondition)}`);

      // workers.setWorkerNetworkConditions("bob", bobCondition);
      // workers.setWorkerNetworkConditions("alice", aliceCondition);
      // workers.setWorkerNetworkConditions("ivy", ivyCondition);

      // Sync all workers
      console.log("Syncing bob");
      await bob.client.conversations.sync();

      console.log("Syncing alice");
      await alice.client.conversations.sync();

      console.log("Syncing ivy");
      await ivy.client.conversations.sync();

      if (!groupId) {
        globalGroup = await bob.client.conversations.newGroup([]);
      } else {
        globalGroup =
          await bob.client.conversations.getConversationById(groupId);
      }
      if (!globalGroup) {
        throw new Error("Failed to get group");
      }
      console.log("Get group with ID:", globalGroup.id);
    } catch (e) {
      hasFailures = logError(e, expect);
    }
  });

  it("add all workers to group", async () => {
    try {
      const inboxIds = [
        manualUsers.xmtpchat.inboxId,
        manualUsers.convos.inboxId,
        bob.client.inboxId,
        alice.client.inboxId,
        ivy.client.inboxId,
      ];
      await (globalGroup as Group).addMembers(inboxIds);
      console.log("Added all workers to group");
    } catch (e) {
      hasFailures = logError(e, expect);
    }
  });

  it("should send messages to group", async () => {
    try {
      // Bob sends first message after creating the group
      await sendMessageWithCount(bob, "bob");

      // Add alice to the group and have her send a message
      await (globalGroup as Group).removeMembers([alice.client.inboxId]);
      console.log("Removed alice from group");

      // Add ivy to the group and have her send a message
      await (globalGroup as Group).addMembers([ivy.client.inboxId]);
      console.log("Added ivy to group");
      await sendMessageWithCount(ivy, "ivy");

      // Add alice to the group and have her send a message
      await (globalGroup as Group).addMembers([alice.client.inboxId]);
      console.log("Added alice to group");
      await sendMessageWithCount(alice, "alice");

      // Add alice to the group and have her send a message
      await (globalGroup as Group).removeMembers([ivy.client.inboxId]);
      console.log("Removed alice from group");
      await sendMessageWithCount(alice, "alice");
    } catch (e) {
      hasFailures = logError(e, expect);
    }
  });

  it("add all workers to group", async () => {
    try {
      const inboxIds = [
        manualUsers.xmtpchat.inboxId,
        manualUsers.convos.inboxId,
        bob.client.inboxId,
        alice.client.inboxId,
        ivy.client.inboxId,
      ];
      await (globalGroup as Group).addMembers(inboxIds);
      console.log("Added all workers to group");
    } catch (e) {
      hasFailures = logError(e, expect);
    }
  });
});
