// Build step for the public (watch-only) Observatory: turns deployments/testnet.env into app/public/config.json,
// which the hosted site serves at /api/config. No key is read and the operator console stays disabled.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const line of readFileSync(join(root, "deployments", "testnet.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const config = {
  operator: false,
  operatorAddress: null,
  attacker: "0x00000000000000000000000000000000000bad01",
  chains: {
    base: { id: 84532, name: "Base Sepolia", tx: "https://sepolia.basescan.org/tx/", address: "https://sepolia.basescan.org/address/" },
    unichain: { id: 1301, name: "Unichain Sepolia", tx: "https://sepolia.uniscan.xyz/tx/", address: "https://sepolia.uniscan.xyz/address/" },
    lasna: { id: 5318007, name: "Reactive Lasna", tx: "https://lasna.reactscan.net/tx/", address: "https://lasna.reactscan.net/address/" },
  },
  contracts: {
    ledger: env.LEDGER,
    homeMailbox: env.HOME_MAILBOX,
    homeRouter: env.HOME_ROUTER,
    homeGuard: env.HOME_GUARD,
    cover: env.COVER,
    dusd: env.DUSD,
    spokeMailbox: env.SPOKE_A_MAILBOX,
    spokeRouter: env.SPOKE_A,
    spokeGuard: env.SPOKE_A_GUARD,
  },
};
for (const [k, v] of Object.entries(config.contracts)) if (!/^0x[0-9a-fA-F]{40}$/.test(v || "")) throw new Error(`bad address for ${k}`);
writeFileSync(join(root, "app", "public", "config.json"), JSON.stringify(config, null, 2));
console.log("wrote app/public/config.json (watch-only)");
