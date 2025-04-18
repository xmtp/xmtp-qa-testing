import { closeEnv, loadEnv } from "@helpers/client";
import { sendPerformanceResult, sendTestResults } from "@helpers/datadog";
import generatedInboxes from "@helpers/generated-inboxes.json";
import { logError } from "@helpers/logger";
import { verifyStream, verifyStreamAll } from "@helpers/streams";
import { getWorkers, type WorkerManager } from "@workers/manager";
import {
  Client,
  IdentifierKind,
  type Conversation,
  type Group,
} from "@xmtp/node-sdk";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const testName = "ts_performance";
loadEnv(testName);

const batchSize = parseInt(
  process.env.CLI_BATCH_SIZE ?? process.env.BATCH_SIZE ?? "5",
);
const total = parseInt(
  process.env.CLI_GROUP_SIZE ?? process.env.MAX_GROUP_SIZE ?? "10",
);
console.log(`[${testName}] Batch size: ${batchSize}, Total: ${total}`);

describe(testName, () => {
  let dm: Conversation;
  let workers: WorkerManager;
  let start: number;
  let hasFailures: boolean = false;

  beforeAll(async () => {
    try {
      workers = await getWorkers(
        [
          "henry-a-203",
          "ivy-a-100",
          "jack-a-202",
          "karen-a-100",
          "randomguy-a-100",
          "randomguy2-a-203",
          "larry-a-100",
          "mary-a-105",
          "nancy-a-100",
          "oscar-a-105",
        ],
        testName,
      );
      expect(workers).toBeDefined();
      expect(workers.getWorkers().length).toBe(10);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  beforeEach(() => {
    const testName = expect.getState().currentTestName;
    start = performance.now();
    console.time(testName);
  });

  afterEach(function () {
    try {
      sendPerformanceResult(expect, workers, start);
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

  it("clientCreate: should measure creating a client", async () => {
    try {
      const client = await getWorkers(["randomclient"], testName, "message");
      expect(client).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("canMessage: should measure canMessage", async () => {
    try {
      const client = await getWorkers(["randomclient"], testName, "none");
      if (!client) {
        throw new Error("Client not found");
      }

      const randomAddress = client.get("randomclient")!.address;
      if (!randomAddress) {
        throw new Error("Random client not found");
      }
      const canMessage = await Client.canMessage(
        [
          {
            identifier: randomAddress,
            identifierKind: IdentifierKind.Ethereum,
          },
        ],
        client.get("randomclient")!.env,
      );
      expect(canMessage.get(randomAddress.toLowerCase())).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("inboxState: should measure inboxState of henry", async () => {
    try {
      const inboxState = await workers
        .get("henry")!
        .client.preferences.inboxState(true);
      expect(inboxState.installations.length).toBeGreaterThan(0);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("newDm: should measure creating a DM", async () => {
    try {
      dm = await workers
        .get("henry")!
        .client.conversations.newDm(workers.get("randomguy")!.client.inboxId);

      expect(dm).toBeDefined();
      expect(dm.id).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it("newDmWithIdentifiers: should measure creating a DM", async () => {
    try {
      const dm2 = await workers
        .get("henry")!
        .client.conversations.newDmWithIdentifier({
          identifier: workers.get("randomguy2")!.address,
          identifierKind: IdentifierKind.Ethereum,
        });

      expect(dm2).toBeDefined();
      expect(dm2.id).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  it("sendGM: should measure sending a gm", async () => {
    try {
      // We'll expect this random message to appear in Joe's stream
      const message = "gm-" + Math.random().toString(36).substring(2, 15);

      console.log(
        `[${workers.get("henry")!.name}] Creating DM with ${workers.get("randomguy")!.name} at ${workers.get("randomguy")!.client.inboxId}`,
      );

      const dmId = await dm.send(message);

      expect(dmId).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  it("receiveGM: should measure receiving a gm", async () => {
    try {
      const verifyResult = await verifyStream(dm, [workers.get("randomguy")!]);

      expect(verifyResult.messages.length).toEqual(1);
      expect(verifyResult.allReceived).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  let i = 4;
  let newGroup: Conversation;
  it(`createGroup: should create a large group of ${i} participants ${i}`, async () => {
    try {
      const sliced = generatedInboxes.slice(0, i);
      newGroup = await workers
        .get("henry")!
        .client.conversations.newGroup(sliced.map((inbox) => inbox.inboxId));
      console.log("New group created", newGroup.id);
      expect(newGroup.id).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`createGroupByIdentifiers: should create a large group of ${i} participants ${i}`, async () => {
    try {
      const sliced = generatedInboxes.slice(0, i);
      const newGroupByIdentifier = await workers
        .get("henry")!
        .client.conversations.newGroupWithIdentifiers(
          sliced.map((inbox) => ({
            identifier: inbox.accountAddress,
            identifierKind: IdentifierKind.Ethereum,
          })),
        );
      expect(newGroupByIdentifier.id).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`syncGroup: should sync a large group of ${i} participants ${i}`, async () => {
    try {
      await newGroup.sync();
      const members = await newGroup.members();
      expect(members.length).toBe(i + 1);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`updateGroupName: should update the group name`, async () => {
    try {
      const newName = "Large Group";
      await (newGroup as Group).updateName(newName);
      await newGroup.sync();
      const name = (newGroup as Group).name;
      expect(name).toBe(newName);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`removeMembers: should remove a participant from a group`, async () => {
    try {
      const previousMembers = await newGroup.members();
      await (newGroup as Group).removeMembers([
        previousMembers.filter(
          (member) => member.inboxId !== (newGroup as Group).addedByInboxId,
        )[0].inboxId,
      ]);

      const members = await newGroup.members();
      expect(members.length).toBe(previousMembers.length - 1);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`sendGroupMessage: should measure sending a gm in a group of ${i} participants`, async () => {
    try {
      const groupMessage = "gm-" + Math.random().toString(36).substring(2, 15);

      await newGroup.send(groupMessage);
      console.log("GM Message sent in group", groupMessage);
      expect(groupMessage).toBeDefined();
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });
  it(`receiveGroupMessage: should create a group and measure all streams`, async () => {
    try {
      const verifyResult = await verifyStreamAll(newGroup, workers);
      expect(verifyResult.allReceived).toBe(true);
    } catch (e) {
      hasFailures = logError(e, expect);
      throw e;
    }
  });

  for (let i = batchSize; i <= total; i += batchSize) {
    let newGroup: Conversation;
    it(`createGroup-${i}: should create a large group of ${i} participants ${i}`, async () => {
      try {
        const sliced = generatedInboxes.slice(0, i);
        newGroup = await workers
          .get("henry")!
          .client.conversations.newGroup(sliced.map((inbox) => inbox.inboxId));
        expect(newGroup.id).toBeDefined();
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`createGroupByIdentifiers-${i}: should create a large group of ${i} participants ${i}`, async () => {
      try {
        const sliced = generatedInboxes.slice(0, i);
        const newGroupByIdentifier = await workers
          .get("henry")!
          .client.conversations.newGroupWithIdentifiers(
            sliced.map((inbox) => ({
              identifier: inbox.accountAddress,
              identifierKind: IdentifierKind.Ethereum,
            })),
          );
        expect(newGroupByIdentifier.id).toBeDefined();
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`syncGroup-${i}: should sync a large group of ${i} participants ${i}`, async () => {
      try {
        await newGroup.sync();
        const members = await newGroup.members();
        expect(members.length).toBe(i + 1);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`updateGroupName-${i}: should update the group name`, async () => {
      try {
        const newName = "Large Group";
        await (newGroup as Group).updateName(newName);
        await newGroup.sync();
        const name = (newGroup as Group).name;
        expect(name).toBe(newName);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`removeMembers-${i}: should remove a participant from a group`, async () => {
      try {
        const previousMembers = await newGroup.members();
        await (newGroup as Group).removeMembers([
          previousMembers.filter(
            (member) => member.inboxId !== (newGroup as Group).addedByInboxId,
          )[0].inboxId,
        ]);

        const members = await newGroup.members();
        expect(members.length).toBe(previousMembers.length - 1);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`sendGroupMessage-${i}: should measure sending a gm in a group of ${i} participants`, async () => {
      try {
        const groupMessage =
          "gm-" + Math.random().toString(36).substring(2, 15);

        await newGroup.send(groupMessage);
        console.log("GM Message sent in group", groupMessage);
        expect(groupMessage).toBeDefined();
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
    it(`receiveGroupMessage-${i}: should create a group and measure all streams`, async () => {
      try {
        const verifyResult = await verifyStreamAll(newGroup, workers);
        expect(verifyResult.allReceived).toBe(true);
      } catch (e) {
        hasFailures = logError(e, expect);
        throw e;
      }
    });
  }
});
