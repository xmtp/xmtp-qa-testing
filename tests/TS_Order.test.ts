import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger, flushLogger, overrideConsole } from "../helpers/logger";
import {
  defaultValues,
  WorkerNames,
  type Conversation,
  type Persona,
  type XmtpEnv,
} from "../helpers/types";
import { getWorkers } from "../helpers/workers/creator";
import { verifyStream } from "../helpers/workers/stream";

const amount = 30; // Number of messages to collect per receiver
const testName = "TS_Order";
const env: XmtpEnv = "dev";
const timeoutMax = amount * defaultValues.perMessageTimeout;
describe(
  "TC_StreamOrder: should verify message order when receiving via streams",
  () => {
    let personas: Record<string, Persona>;

    let gmMessageGenerator: (i: number, suffix: string) => Promise<string>;
    let gmSender: (convo: Conversation, message: string) => Promise<void>;

    beforeAll(async () => {
      const logger = createLogger(testName);
      overrideConsole(logger);
      personas = await getWorkers(
        [
          WorkerNames.BOB,
          WorkerNames.ALICE,
          WorkerNames.JOE,
          WorkerNames.SAM,
          WorkerNames.CHARLIE,
          WorkerNames.DAVE,
          WorkerNames.EVE,
          WorkerNames.FRANK,
          WorkerNames.GRACE,
          WorkerNames.HENRY,
          WorkerNames.IVY,
          WorkerNames.JACK,
          WorkerNames.KAREN,
          WorkerNames.LARRY,
        ],
        env,
        testName,
      );
    });

    afterAll(async () => {
      await flushLogger(testName);
      await Promise.all(
        Object.values(personas).map(async (persona) => {
          await persona.worker?.terminate();
        }),
      );
    });

    it("TC_StreamOrder: should verify message order when receiving via streams", async () => {
      // Create a new group conversation with Bob (creator), Joe, Alice, Charlie, Dan, Eva, Frank, Grace, Henry, Ivy, and Sam.
      const group = await personas["bob"].client!.conversations.newGroup(
        Object.values(personas).map(
          (p) => p.client?.accountAddress as `0x${string}`,
        ),
      );
      console.log("Group created", group.id);
      expect(group.id).toBeDefined();

      // Define receivers (excluding Bob, the creator).
      const receivers = Object.values(personas).filter(
        (p) =>
          p.client?.accountAddress !==
          personas[WorkerNames.BOB].client?.accountAddress,
      );

      gmMessageGenerator = async (i: number, suffix: string) => {
        return `gm-${i + 1}-${suffix}`;
      };
      gmSender = async (convo: Conversation, message: string) => {
        await convo.send(message);
      };

      // Collect messages by setting up listeners before sending and then sending known messages.
      const collectedMessages = await verifyStream(
        group,
        receivers,
        gmMessageGenerator,
        gmSender,
        "text",
        10,
      );

      console.log("allReceived", collectedMessages.allReceived);
      expect(collectedMessages.allReceived).toBe(true);

      // Verify the order of received messages
      const receivedMessages = collectedMessages.messages.flat();
      const expectedMessages = Array.from(
        { length: 10 },
        (_, i) => `gm-${i + 1}-${receivedMessages[0].split("-")[2]}`,
      );

      const inOrder = receivedMessages.every(
        (msg, index) => msg === expectedMessages[index],
      );

      console.log("Messages received in order:", inOrder);
      expect(inOrder).toBe(false);
    });

    it("TC_PullOrder: should verify message order when receiving via pull", async () => {
      console.time("createGroup");
      const group = await personas[
        WorkerNames.BOB
      ].client!.conversations.newGroup([
        personas[WorkerNames.JOE].client?.accountAddress as `0x${string}`,
        personas[WorkerNames.BOB].client?.accountAddress as `0x${string}`,
        personas[WorkerNames.ALICE].client?.accountAddress as `0x${string}`,
        personas[WorkerNames.SAM].client?.accountAddress as `0x${string}`,
      ]);
      console.log("Group created", group.id);
      expect(group.id).toBeDefined();
      console.timeEnd("createGroup");

      console.time("sendMessages");
      const randomMessage = Math.random().toString(36).substring(2, 15);
      const messages: string[] = [];
      for (let i = 0; i < amount; i++) {
        messages.push("message-" + (i + 1).toString() + "-" + randomMessage);
      }

      // Send messages sequentially to maintain order
      for (const msg of messages) {
        await group.send(msg);
      }
      console.timeEnd("sendMessages");

      console.time("pullMessages");
      // Pull messages for both recipients
      const conversation = personas[
        WorkerNames.ALICE
      ].client!.conversations.getConversationById(group.id);
      const aliceMessages = await conversation!.messages();
      const parsedAliceMessages = aliceMessages.map(
        (msg) => msg.content as string,
      );
      const joeConversation = personas[
        WorkerNames.JOE
      ].client!.conversations.getConversationById(group.id);
      const joeMessages = await joeConversation!.messages();
      const parsedJoeMessages = joeMessages.map((msg) => msg.content as string);

      const samConversation = personas[
        WorkerNames.SAM
      ].client!.conversations.getConversationById(group.id);
      const samMessages = await samConversation!.messages();
      const parsedSamMessages = samMessages.map((msg) => msg.content as string);
      console.timeEnd("pullMessages");
      // Verify the order of messages received by Alice
      expect(parsedAliceMessages).toEqual(messages);
      console.log("Alice received messages in order");

      // Verify the order of messages received by Joe
      expect(parsedJoeMessages).toEqual(messages);
      console.log("Joe received messages in order");

      // Verify the order of messages received by Sam
      expect(parsedSamMessages).toEqual(messages);
      console.log("Sam received messages in order");
    });
  },
  timeoutMax, // 100 seconds
);
