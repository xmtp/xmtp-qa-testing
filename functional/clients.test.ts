import { closeEnv, loadEnv } from "@helpers/client";
import { logError } from "@helpers/logger";
import { IdentifierKind } from "@helpers/types";
import { getWorkers, type WorkerManager } from "@workers/manager";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testName = "clients";
loadEnv(testName);

describe(testName, () => {
  let workers: WorkerManager;
  beforeAll(async () => {
    workers = await getWorkers(
      [
        "henry",
        "ivy",
        "jack",
        "karen",
        "bob",
        "randomguy",
        "larry",
        "mary",
        "nancy",
        "oscar",
      ],
      testName,
    );
  });
  afterAll(async () => {
    try {
      await closeEnv(testName, workers);
    } catch (e) {
      logError(e, expect);
      throw e;
    }
  });

  it("clientCreate: should measure creating a client", async () => {
    try {
      const client = await getWorkers(["randomclient"], testName, "message");
      expect(client).toBeDefined();
    } catch (e) {
      logError(e, expect);
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
      const canMessage = await workers.get("henry")!.client.canMessage([
        {
          identifier: randomAddress,
          identifierKind: IdentifierKind.Ethereum,
        },
      ]);
      expect(canMessage.get(randomAddress)).toBe(true);
    } catch (e) {
      logError(e, expect);
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
      logError(e, expect);
      throw e;
    }
  });
  it("inboxStateFromInboxIds: should measure inboxState of henry", async () => {
    try {
      const bobInboxId = workers.get("bob")!.client.inboxId;
      const inboxState = await workers
        .get("henry")!
        .client.preferences.inboxStateFromInboxIds([bobInboxId], true);
      console.log(inboxState[0].inboxId);
      expect(inboxState[0].inboxId).toBe(bobInboxId);
    } catch (e) {
      logError(e, expect);
      throw e;
    }
  });
});
