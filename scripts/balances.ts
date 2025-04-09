import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { mainnet } from "viem/chains";

// USDC contract address on Ethereum mainnet
const USDC_ADDRESS = [""];

// ABI for ERC20 token (only methods we need)
const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
];

// Create public client
const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

// Check ETH balance
const getEthBalance = async (address: string): Promise<string> => {
  try {
    const balance = await client.getBalance({
      address: address as `0x${string}`,
    });
    return formatEther(balance);
  } catch (error) {
    console.error(`Error getting ETH balance for ${address}:`, error);
    return "Error";
  }
};

// Main function
const main = async () => {
  const addresses = new Set(USDC_ADDRESS);
  // Filter out specific address
  const addressToFilter = [
    "0xcb81dbc7e50505a0dc369de7a562fd0689ec264f",
    "0x995e93fd909e1f7fdd7005c20f77b0079155bd5f",
  ];
  const filteredAddresses = new Set(
    [...addresses].filter((address) => !addressToFilter.includes(address)),
  );

  console.log(`Found ${filteredAddresses.size} unique wallet addresses.`);

  // Define minimum USD threshold
  const MIN_USD_THRESHOLD = 100;

  // Table header
  console.log(`Address | ETH Balance | USD Balance (>= $${MIN_USD_THRESHOLD})`);
  console.log("--------|------------|-------------");

  let usd = 0;
  let filteredCount = 0;

  // Process each address
  for (const address of filteredAddresses) {
    const ethBalance = await getEthBalance(address);
    const usdBalance = Number(ethBalance) * 1600;

    // Only display and count addresses with balance >= MIN_USD_THRESHOLD
    if (usdBalance >= MIN_USD_THRESHOLD) {
      console.log(`${address} | ${ethBalance} | ${usdBalance}`);
      usd += usdBalance;
      filteredCount++;
    }
  }

  console.log(
    `\nFound ${filteredCount} addresses with balance >= $${MIN_USD_THRESHOLD}`,
  );
  console.log(`Total USD Balance: ${usd}`);
};

// Run the script
main().catch(console.error);
