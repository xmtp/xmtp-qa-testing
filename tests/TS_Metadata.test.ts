import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger, flushLogger, overrideConsole } from "../helpers/logger";
import { type Conversation, type Persona } from "../helpers/types";
import { verifyMetadataUpdates } from "../helpers/verify";
import { getWorkers } from "../helpers/workers/creator";

const env = "dev";
const testName = "TS_Metadata_" + env;
/* TODO:
time streams without timeouts
*/
describe(testName, () => {
  let bob: Persona;
  let joe: Persona;
  let bobsGroup: Conversation;
  let elon: Persona;
  let alice: Persona;
  let fabri: Persona;
  let personas: Persona[];
  beforeAll(async () => {
    const logger = createLogger(testName);
    overrideConsole(logger);
    personas = await getWorkers(
      ["bob", "joe", "elon", "fabri", "alice"],
      "dev",
      testName,
    );
    [bob, joe, elon, fabri, alice] = personas;

    console.time("create group");
    bobsGroup = await bob.client!.conversations.newGroup([
      bob.client?.accountAddress as `0x${string}`,
      joe.client?.accountAddress as `0x${string}`,
      elon.client?.accountAddress as `0x${string}`,
    ]);
    console.log("Bob's group", bobsGroup.id);
    console.timeEnd("create group");
  });

  afterAll(async () => {
    await flushLogger(testName);
    await Promise.all(
      personas.map(async (persona) => {
        await persona.worker?.terminate();
      }),
    );
  });

  it("TC_ReceiveMetadata: should update group name", async () => {
    console.time("update group name");
    const newGroupName =
      "New Group Name" + Math.random().toString(36).substring(2, 15);
    const result = await verifyMetadataUpdates(
      () => bobsGroup.updateName(newGroupName),
      [joe],
      { fieldName: "group_name", newValue: newGroupName },
    );
    expect(result).toEqual([newGroupName]);
    console.timeEnd("update group name");
  });

  it("TC_AddMembers: should measure adding a participant to a group", async () => {
    console.time("add members");
    await bobsGroup.addMembers([fabri.client?.accountAddress as `0x${string}`]);
    const members = await bobsGroup.members();
    console.timeEnd("add members");
    expect(members.length).toBe(4);
  });

  it("TC_RemoveMembers: should remove a participant from a group", async () => {
    console.time("remove members");
    await bobsGroup.removeMembers([
      fabri.client?.accountAddress as `0x${string}`,
    ]);
    const members = await bobsGroup.members();
    console.timeEnd("remove members");
    expect(members.length).toBe(3);
  });
});
