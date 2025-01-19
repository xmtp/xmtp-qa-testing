import { describe, test, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { XMTP, createUser, xmtpClient } from "@xmtp/agent-starter";

describe("Client Private Key Configuration Tests", () => {
  test("creates a client with a random generated key", async () => {
    const xmtp = new XMTP();
    await xmtp.init();
    expect(xmtp?.inboxId).toBeDefined();
  }, 25000); // Added 15 second timeout

  test("creates a client with a provided private key", async () => {
    const encryptionKey = generatePrivateKey();
    const xmtp = new XMTP({
      encryptionKey,
      onMessage: async () => {},
    });
    await xmtp.init();
    expect(xmtp?.inboxId).toBeDefined();
  }, 15000); // Added 15 second timeout

  test("creates user with valid private key", () => {
    const privateKey = generatePrivateKey();
    const user = createUser(privateKey);

    expect(user.key).toBe(privateKey);
    expect(user.account).toBeDefined();
    expect(user.wallet).toBeDefined();
  }, 15000); // Added 15 second timeout

  test("Creates a key with a agent name", async () => {
    const agentName = "bob1";
    const xmtp = await xmtpClient({
      name: agentName,
    });
    expect(xmtp?.inboxId).toBeDefined();
  });

  test("fails gracefully with invalid private key format", async () => {
    const invalidKey = "invalid_key";

    try {
      const xmtp = new XMTP({
        encryptionKey: invalidKey,
        onMessage: async () => {},
      });
      await xmtp.init();
      // If no error is thrown, fail the test
      throw new Error("Expected error was not thrown");
    } catch (error) {
      // Check if the error is the expected one
      expect(error.message).toContain("invalid private key");
    }
  }, 15000); // Added 15 second timeout
});
