import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateEncryptionKeyHex } from "@helpers/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

console.log("Generating keys...");

const person = process.argv[2];
if (!person) {
  console.error("Please provide a name: yarn gen:keys <name>");
  process.exit(1);
}

const walletKey = generatePrivateKey();
const account = privateKeyToAccount(walletKey);
const encryptionKeyHex = generateEncryptionKeyHex();
const publicKey = account.address;

const filePath = join(process.cwd(), ".env");

await writeFile(
  filePath,
  `# ${person.toLowerCase()}
WALLET_KEY_${person.toUpperCase()}=${walletKey}
ENCRYPTION_KEY_${person.toUpperCase()}=${encryptionKeyHex}
# public key is ${publicKey}
`,
  { flag: "a" },
);

console.log(`Keys for ${person} written to ${filePath}`);
