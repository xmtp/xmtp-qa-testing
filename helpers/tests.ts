const versions = ["100", "104", "105"];

// Network condition presets for testing
const networkConditions = {
  highLatency: { latencyMs: 1000, jitterMs: 200 },
  packetLoss: { packetLossRate: 0.3 },
  disconnection: { disconnectProbability: 0.2, disconnectDurationMs: 5000 },
  bandwidthLimit: { bandwidthLimitKbps: 100 },
  poorConnection: {
    latencyMs: 500,
    jitterMs: 100,
    packetLossRate: 0.1,
    bandwidthLimitKbps: 200,
  },
} as const;

type NetworkConditionKey = keyof typeof networkConditions;
type NetworkCondition = (typeof networkConditions)[NetworkConditionKey];

// Function to get a random version from the versions array
export const getRandomVersion = () => {
  const randomIndex = Math.floor(Math.random() * versions.length);
  return versions[randomIndex];
};

// Function to get a random network condition
export const getRandomNetworkCondition = (): NetworkCondition => {
  const conditions = Object.keys(networkConditions) as NetworkConditionKey[];
  const randomIndex = Math.floor(Math.random() * conditions.length);
  return networkConditions[conditions[randomIndex]];
};

export const manualUsers: {
  [key: string]: {
    inboxId: string;
    env: string;
  };
} = {
  convos: {
    inboxId: "7b7eefbfb80e019656b6566101d6903ec8cf5494e2d6ae5ef0a4c4c886d86a47",
    env: "dev",
  },
  xmtpchat: {
    inboxId: "dc85c4016ededfe9745c8eb623fc7473be85498bfd70703300d99dc29e10f235",
    env: "dev",
  },
};
