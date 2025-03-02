import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { closeEnv, loadEnv } from "../helpers/client";
import { sendMetric } from "../helpers/datadog";
import { type Conversation, type Persona } from "../helpers/types";
import { getPersonasFromGroup, verifyStream } from "../helpers/verify";
import { getWorkers } from "../helpers/workers/factory";

const testName = "groups";
await loadEnv(testName);

describe(testName, () => {
  let personas: Record<string, Persona>;
  let convo: Conversation;
  let start: number;

  beforeEach(() => {
    const testName = expect.getState().currentTestName;
    start = performance.now();
    console.time(testName);
  });

  afterAll(async () => {
    await closeEnv(testName, personas);
  });
  beforeAll(async () => {
    personas = await getWorkers(
      [
        "henry",
        "ivy",
        "jack",
        "karen",
        "larry",
        "mary",
        "nancy",
        "oscar",
        "randomguy",
        "zack",
        "adam",
        "bella",
        "carl",
        "diana",
        "eric",
        "fiona",
        "george",
        "hannah",
        "ian",
        "julia",
        "keith",
        "lisa",
        "mike",
        "nina",
        "oliver",
        "penny",
        "quentin",
        "rosa",
        "sam",
        "tina",
        "uma",
        "vince",
        "walt",
        "xena",
        "yara",
        "zara",
        "guada",
      ],
      testName,
    );
  });

  afterEach(function () {
    const testName = expect.getState().currentTestName;
    if (testName) {
      void sendMetric(performance.now() - start, testName, personas);
      console.timeEnd(testName);
    }
  });

  it("createGroup: should measure creating a group", async () => {
    convo = await personas.henry.client!.conversations.newGroup([
      personas.ivy.client!.accountAddress as `0x${string}`,
      personas.jack.client!.accountAddress as `0x${string}`,
      personas.karen.client!.accountAddress as `0x${string}`,
      personas.nancy.client!.accountAddress as `0x${string}`,
      personas.oscar.client!.accountAddress as `0x${string}`,
      personas.mary.client!.accountAddress as `0x${string}`,
      personas.larry.client!.accountAddress as `0x${string}`,
    ]);
    console.log("Henry's group", convo.id);
    expect(convo.id).toBeDefined();
  });

  it("createGroupByInboxIds: should measure creating a group with inbox ids", async () => {
    const groupByInboxIds =
      await personas.henry.client!.conversations.newGroupByInboxIds([
        personas.ivy.client!.inboxId,
        personas.jack.client!.inboxId,
        personas.karen.client!.inboxId,
      ]);

    console.log("Henry's groupByInboxIds", groupByInboxIds.id);
    expect(groupByInboxIds.id).toBeDefined();
  });

  it("updateGroupName: should create a group and update group name", async () => {
    const result = await verifyStream(convo, [personas.nancy], "group_updated");
    expect(result.allReceived).toBe(true);
  });

  it("addMembers: should measure adding a participant to a group", async () => {
    await convo.addMembers([
      personas.randomguy.client!.accountAddress as `0x${string}`,
    ]);
  });
  it("syncAndMembers: should measure syncing a group", async () => {
    await convo.sync();
    await convo.members();
  });

  it("removeMembers: should remove a participant from a group", async () => {
    const previousMembers = await convo.members();
    await convo.removeMembers([
      personas.nancy.client!.accountAddress as `0x${string}`,
    ]);
    const members = await convo.members();
    expect(members.length).toBe(previousMembers.length - 1);
  });

  it("sendGroupMessage: should measure sending a gm in a group", async () => {
    const groupMessage = "gm-" + Math.random().toString(36).substring(2, 15);

    await convo.send(groupMessage);
    console.log("GM Message sent in group", groupMessage);
    expect(groupMessage).toBeDefined();
  });

  it("receiveGroupMessage: should create a group and measure all streams", async () => {
    const personasToVerify = await getPersonasFromGroup(convo, personas);
    const verifyResult = await verifyStream(convo, personasToVerify);
    expect(verifyResult.allReceived).toBe(true);
  });

  it("createGroup20: should create a large group of 20 participants", async () => {
    convo = await personas.henry.client!.conversations.newGroupByInboxIds(
      Object.values(personas)
        .slice(0, 20)
        .map((p) => p.client?.inboxId as string),
    );
    expect(convo.id).toBeDefined();
  });

  it("sendGroupMessage20: should measure sending a gm in a group", async () => {
    const groupMessage = "gm-" + Math.random().toString(36).substring(2, 15);

    await convo.send(groupMessage);
    console.log("GM Message sent in group", groupMessage);
    expect(groupMessage).toBeDefined();
  });

  it("receiveGroupMessage20: should create a group and measure all streams", async () => {
    const personasToVerify = await getPersonasFromGroup(convo, personas);
    const verifyResult = await verifyStream(convo, personasToVerify);
    expect(verifyResult.allReceived).toBe(true);
  });
});
