import {
  ConsentEntityType,
  ConsentState,
  type Consent,
  type LogLevel,
} from "@xmtp/node-bindings";
import {
  Client,
  Conversation,
  Dm,
  Group,
  type DecodedMessage,
  type Installation,
  type Signer,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import type { WorkerClient } from "./workers/main";

export type NestedPersonasStructure = Record<string, Record<string, Persona>>;

export class NestedPersonas {
  private personas: NestedPersonasStructure;

  constructor(personas: NestedPersonasStructure) {
    this.personas = personas;
  }

  // Method to get the total number of personas
  public getLength(): number {
    let count = 0;
    for (const baseName in this.personas) {
      count += Object.keys(this.personas[baseName]).length;
    }
    return count;
  }

  public getVersion(): string {
    return this.personas[Object.keys(this.personas)[0]][
      Object.keys(this.personas[Object.keys(this.personas)[0]])[0]
    ].version;
  }

  getPersonas(): Persona[] {
    const allPersonas: Persona[] = [];
    for (const baseName in this.personas) {
      for (const installationId in this.personas[baseName]) {
        allPersonas.push(this.personas[baseName][installationId]);
      }
    }
    return allPersonas;
  }

  // Method to get a specific persona
  public get(
    baseName: string,
    installationId: string = "a",
  ): Persona | undefined {
    return this.personas[baseName][installationId];
  }

  // Additional methods to manipulate or access personas can be added here
}
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

export interface Persona {
  name: string;
  installationId: string;
  version: string;
  dbPath: string;
  worker: WorkerClient | null;
  client: Client | null;
}

export type GroupMetadataContent = {
  metadataFieldChanges: Array<{
    fieldName: string;
    newValue: string;
    oldValue: string;
  }>;
};

// Default personas as an enum
const defaultNames = [
  "bob",
  "alice",
  "fabri",
  "bot",
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
export interface PersonaBase {
  name: string;
  folder: string;
  walletKey: string;
  encryptionKey: string;
  testName: string;
}

export interface Persona extends PersonaBase {
  worker: WorkerClient | null;
  dbPath: string;
  client: Client | null;
  version: string;
  installationId: string;
  address: string;
}
