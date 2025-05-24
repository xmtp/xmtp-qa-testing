import { loadEnv } from "@helpers/client";
import { getFixedNames } from "@helpers/tests";
import { typeofStream } from "@workers/main";
import { getWorkers, type WorkerManager } from "@workers/manager";
import type { Group } from "@xmtp/node-sdk";
import { beforeAll, describe, expect, it } from "vitest";

const testName = "bug_welcome";
loadEnv(testName);

describe(testName, () => {
  let workers: WorkerManager;
  let group: Group;

  beforeAll(async () => {
    const names = getFixedNames(10);
    workers = await getWorkers(names, testName, typeofStream.Message);
    await getWorkers(names, testName, typeofStream.Conversation);
  });

  it("stream: send the stream", async () => {
    group = await workers.createGroup();
    console.log("Group created", group.id);
    expect(group.id).toBeDefined();
  });
  it("stream: send the stream", async () => {
    group = await workers.createGroup();
    console.log("Group created", group.id);
    expect(group.id).toBeDefined();
  });
});
