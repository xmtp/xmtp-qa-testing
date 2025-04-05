import { loadEnv } from "@helpers/client";
import { getWorkers } from "@workers/manager";
import { describe, expect, it } from "vitest";

const testName = "installations";
loadEnv(testName);
const names = ["random1", "random2 ", "random3", "random4", "random5"];
describe(testName, () => {
  it("should create and use workers on demand", async () => {
    let initialWorkers = await getWorkers(names, testName);
    expect(initialWorkers.get(names[0])?.folder).toBe("a");
    expect(initialWorkers.get(names[1])?.folder).toBe("a");

    // Create a different installation of alice
    const secondaryWorkers = await getWorkers(
      [names[0] + "-desktop", names[1] + "-b"],
      testName,
    );
    // Merge the new workers with the existing ones
    expect(secondaryWorkers.get(names[0], "desktop")?.folder).toBe("desktop");
    expect(secondaryWorkers.get(names[1], "b")?.folder).toBe("b");

    // Verify installations of the same person share identity
    expect(initialWorkers.get(names[1])?.client.inboxId).toBe(
      secondaryWorkers.get(names[1], "b")?.client.inboxId,
    );
    expect(initialWorkers.get(names[0])?.client.inboxId).toBe(
      secondaryWorkers.get(names[0], "desktop")?.client.inboxId,
    );
    expect(initialWorkers.get(names[1])?.dbPath).not.toBe(
      secondaryWorkers.get(names[1], "b")?.dbPath,
    );

    // But have different database paths
    expect(secondaryWorkers.get(names[0], "desktop")?.dbPath).not.toBe(
      secondaryWorkers.get(names[1], "b")?.dbPath,
    );
    // Create charlie only when we need him
    const terciaryWorkers = await getWorkers([names[2]], testName);

    // Send a message from alice's desktop to charlie
    const aliceDesktop = secondaryWorkers.get(names[0], "desktop");
    const conversation = await aliceDesktop?.client.conversations.newDm(
      terciaryWorkers.get(names[2])?.client.inboxId ?? "",
    );
    await conversation?.send("Hello Charlie from Alice's desktop");

    // Charlie can see the message
    await terciaryWorkers.get(names[2])?.client.conversations.syncAll();
    const charlieConvs = await terciaryWorkers
      .get(names[2])
      ?.client.conversations.list();
    expect(charlieConvs?.length).toBeGreaterThan(0);

    // Create a backup installation for charlie
    const fourthWorkers = await getWorkers([names[2] + "-c"], testName);
    // Backup installation should also be able to access the conversation after syncing
    await fourthWorkers.get(names[2])?.client.conversations.syncAll();
    const backupConvs = await fourthWorkers
      .get(names[2], "c")
      ?.client.conversations.list();
    expect(backupConvs?.length).toBe(0);
  });

  it("should count installations and handle revocation", async () => {
    // Create initial workers
    const randomString = Math.random().toString(36).substring(2, 15);
    const workers = await getWorkers(
      [
        names[3],
        names[3] + "-" + randomString,
        names[4],
        names[4] + "-" + randomString,
      ],
      testName,
    );

    // Count initial installations
    const davidInitialState = await workers
      .get(names[3])
      ?.client.preferences.inboxState(true);
    const emmaInitialState = await workers
      .get(names[4])
      ?.client.preferences.inboxState(true);
    const davidCount = davidInitialState?.installations.length;
    const emmaCount = emmaInitialState?.installations.length;
    console.log(names[3], davidCount);
    console.log(names[4], emmaCount);
    expect(davidCount).toBe(2); // a + mobile
    expect(emmaCount).toBeGreaterThan(1); // a + tablet

    // TESTED IN XMTP.CHAT
    // Revoke david's mobile installation by terminating and clearing
    const davidClient = workers.get(names[3])?.client;
    await davidClient?.revokeAllOtherInstallations();
    await workers.get(names[3], "mobile")?.worker.clearDB();
    // Count installations after revocation
    const davidFinalState = await davidClient?.preferences.inboxState(true);
    const davidFinalCount = davidFinalState?.installations.length;
    console.log(names[3], davidFinalCount);
    expect(davidFinalCount).toBe(1); // only a
  });
});
