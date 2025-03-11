import { closeEnv, loadEnv } from "@helpers/client";
import { type Group, type NestedPersonas } from "@helpers/types";
import { verifyStream } from "@helpers/verify";
import { getWorkers } from "@helpers/workers/factory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testName = "metadata";
loadEnv(testName);

describe(testName, () => {
  let group: Group;
  let personas: NestedPersonas;
  beforeAll(async () => {
    personas = await getWorkers(
      [
        "henry",
        "ivy",
        "jack",
        "karen",
        "randomguy",
        "larry",
        "mary",
        "nancy",
        "oscar",
      ],
      testName,
    );

    console.time("create group");
    group = await personas
      .get("henry")!
      .client!.conversations.newGroupByInboxIds([
        personas.get("nancy")?.client?.inboxId ?? "",
        personas.get("oscar")?.client?.inboxId ?? "",
        personas.get("jack")?.client?.inboxId ?? "",
      ]);
    console.log("group", group.id);
    console.timeEnd("create group");
  });

  afterAll(async () => {
    await closeEnv(testName, personas);
  });

  it("TC_ReceiveMetadata: should update group name", async () => {
    console.time("update group name");

    const verifyResult = await verifyStream(
      group,
      [personas.get("oscar")!],
      "group_updated",
    );
    expect(verifyResult.allReceived).toBe(true);
    console.timeEnd("update group name");
  });

  it("TC_AddMembers: should measure adding a participant to a group", async () => {
    console.time("add members");
    await group.addMembers([
      personas.get("randomguy")?.client?.accountAddress as `0x${string}`,
    ]);
    const members = await group.members();
    console.timeEnd("add members");
    expect(members.length).toBe(5);
  });

  it("TC_RemoveMembers: should remove a participant from a group", async () => {
    console.time("remove members");
    await group.removeMembers([
      personas.get("randomguy")?.client?.accountAddress as `0x${string}`,
    ]);
    const members = await group.members();
    console.timeEnd("remove members");
    expect(members.length).toBe(4);
  });
});
