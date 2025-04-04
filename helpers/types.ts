import type { Worker, WorkerManager } from "@workers/manager";
import {
  ConsentEntityType,
  ConsentState,
  IdentifierKind,
  type Consent,
  type GroupMember,
  type Installation,
  type LogLevel,
} from "@xmtp/node-bindings";
import {
  Client,
  Conversation,
  Dm,
  Group,
  type DecodedMessage,
  type Signer,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import {
  Client as Client100,
  Conversation as Conversation100,
  Dm as Dm100,
  Group as Group100,
} from "@xmtp/node-sdk-100";

// Add version-specific exports
console.log(
  "SDK v100:",
  Client100?.version,
  "imported from @xmtp/node-sdk-100",
);
console.log("SDK v104:", Client?.version, "imported from @xmtp/node-sdk");

export const sdkVersions = {
  v100: {
    Client: Client100,
    Conversation: Conversation100,
    Dm: Dm100,
    Group: Group100,
  },
  v104: {
    Client,
    Conversation,
    Dm,
    Group,
  },
};
export type { WorkerManager, Worker };
export type WorkerStreamMessage = {
  type: "stream_message";
  message: DecodedMessage;
};
export type { Consent };
export {
  Client,
  ConsentEntityType,
  ConsentState,
  DecodedMessage,
  Conversation,
  Dm,
  Group,
  IdentifierKind,
  type GroupMember,
  type Installation,
  type Signer,
  type LogLevel,
  type XmtpEnv,
};
// Define the expected return type of verifyStream
export type VerifyStreamResult = {
  allReceived: boolean;
  messages: string[][];
};

export type GroupMetadataContent = {
  metadataFieldChanges: Array<{
    fieldName: string;
    newValue: string;
    oldValue: string;
  }>;
};

// Default workers as an enum
const defaultNames = [
  "bob",
  "alice",
  "fabri",
  "elon",
  "joe",
  "charlie",
  "dave",
  "rosalie",
  "eve",
  "frank",
  "grace",
  "henry",
  "ivy",
  "jack",
  "karen",
  "larry",
  "mary",
  "nancy",
  "oscar",
  "paul",
  "quinn",
  "rachel",
  "steve",
  "tom",
  "ursula",
  "victor",
  "wendy",
  "xavier",
  "yolanda",
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
  //max 61
];
export type typeofStream = "message" | "conversation" | "consent" | "none";
export const defaultValues = {
  amount: 5,
  timeout: 40000,
  perMessageTimeout: 3000,
  defaultNames,
};

// Custom transport that buffers logs in memory
export interface LogInfo {
  timestamp: string;
  level: string;
  message: string;
  [key: symbol]: string | undefined;
}
