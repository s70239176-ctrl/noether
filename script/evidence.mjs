#!/usr/bin/env node
// Noether evidence collector: rebuilds the full reactive loop from on-chain logs alone.
//
//   origin event (Unichain/Base) -> Noether reaction (Lasna) -> callbacks landing (Base/Unichain)
//
// Every destination event carries the ORIGIN tx hash and ORIGIN timestamp in its payload, so the
// latency below comes straight from chain data, not from the demo script's clock.
//
// Usage:  node script/evidence.mjs            (reads .env and deployments/testnet.env)
// Env:    LOOKBACK (blocks per chain, default 3000)
// No dependencies: Node >= 18 (global fetch).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv("deployments/testnet.env"), ...process.env };
const LOOKBACK = BigInt(env.LOOKBACK || 3000);

const T = {
  Inbound: "0xba5764db3e9a8df3bad2463f8d86f27941b93eb654eb1d8887fd6dac18f0a470",
  GuardFrozen: "0x5b80d5f298b549177c625a0b311874e8c78be3cf90a52fc0ecfb8df95ab57a8a",
  GuardHeld: "0xa05ace07b203b53119af2e1bde67747cac3a2150928a4c34d6d21bf0aa69b3e4",
  AccountQuarantine: "0xd4c623c7a271e21aabc5fd1f696f88c6075a770fd13d72dd122f322ae2b1a32d",
  PayoutOpened: "0xf48fbf66e7892a68a7dd207a3a3123ef35af620cd2e450204cf252e6d7840906",
  PolicyPaid: "0x593e8f98b32b7ce3696eb73c58c142b91c6e1b1c4ba1c337634fbf6533bea369",
  PolicyExcluded: "0x5f45c79ba841cd90ef7332534c339aad39a0bb9a6e5355caab6cc18a9e57b964",
  PayoutCompleted: "0xc7a0b07afd253e96b71e523a514f788b054bfc6d2aa4e159551190bc3e1c6223",
  ConservationBroken: "0x96c02b34af4ada4895918d86fab09ee9d8319f1005a42a2ec2800215d18c2c8f",
  SuspectRaised: "0x02f5a4ad99086036d1d5bcb1a4f272976e191e6e63344e939f2e3083a67cdeeb",
  SuspectCleared: "0xd46376b8b0401fa9c3c438386c7370b81a60c65d676418d66f6e468237c4268a",
  CallbackSent: "0xff5a126b9933db3e1c1c37e23fbb38578eaa188d3daf8726db51fa22e0e2ae51",
  TaintTraced: "0x33a6f9fe057b4faeef64b69c54dcc4cf36af92b7ba23290d937548625334c575",
};

const REASONS = ["NONE", "UNBACKED_MINT", "MINT_REPLAY", "MINT_MISMATCH", "UNBACKED_RELEASE", "RELEASE_REPLAY", "RELEASE_MISMATCH", "NEURAL_ESCALATION"];

const CHAINS = {
  lasna: { name: "Reactive Lasna", rpc: env.LASNA_RPC, tx: "https://lasna.reactscan.net/tx/" },
  home: { name: "Base Sepolia", rpc: env.BASE_SEPOLIA_RPC, tx: "https://sepolia.basescan.org/tx/" },
  spoke: { name: "Unichain Sepolia", rpc: env.UNICHAIN_SEPOLIA_RPC, tx: "https://sepolia.uniscan.xyz/tx/" },
};

async function rpc(chain, method, params) {
  const res = await fetch(chain.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${chain.name} ${method}: ${body.error.message}`);
  return body.result;
}

const heads = new Map();
async function logs(chain, address, topic0) {
  if (!heads.has(chain.name)) heads.set(chain.name, BigInt(await rpc(chain, "eth_blockNumber", [])));
  const head = heads.get(chain.name);
  const from = head > LOOKBACK ? head - LOOKBACK : 0n;
  const q = (a, b) => rpc(chain, "eth_getLogs", [{ address, topics: [topic0], fromBlock: "0x" + a.toString(16), toBlock: "0x" + b.toString(16) }]);
  try {
    return await q(from, head);
  } catch (e) {
    // Public RPCs cap the block range (e.g. "eth_getLogs is limited to a 200 range"): split and retry.
    const m = String(e.message).match(/(\d{2,})\s*(?:block)?\s*range|range[^\d]*(\d{2,})/i);
    const step = BigInt(m ? m[1] || m[2] : 200) - 1n;
    const out = [];
    for (let a = from; a <= head; a += step + 1n) out.push(...(await q(a, a + step > head ? head : a + step)));
    return out;
  }
}

const blockTs = new Map();
async function timestampOf(chain, blockHex) {
  const k = chain.name + blockHex;
  if (!blockTs.has(k)) blockTs.set(k, Number(BigInt((await rpc(chain, "eth_getBlockByNumber", [blockHex, false])).timestamp)));
  return blockTs.get(k);
}

const words = (data) => (data.slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));
const hex32 = (n) => "0x" + n.toString(16).padStart(64, "0");
const addr = (n) => "0x" + n.toString(16).padStart(40, "0");
const fmt = (wei) => (Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 });
const iso = (ts) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");

async function main() {
  for (const [k, c] of Object.entries(CHAINS)) if (!c.rpc) throw new Error(`missing RPC for ${k}; set it in .env`);
  const out = [];
  const p = (s = "") => { out.push(s); console.log(s); };

  const [broken, raised, cleared, sent, taints] = await Promise.all([
    logs(CHAINS.lasna, env.LEDGER, T.ConservationBroken),
    logs(CHAINS.lasna, env.LEDGER, T.SuspectRaised),
    logs(CHAINS.lasna, env.LEDGER, T.SuspectCleared),
    logs(CHAINS.lasna, env.LEDGER, T.CallbackSent),
    logs(CHAINS.lasna, env.LEDGER, T.TaintTraced),
  ]);
  const [homeInbound, homeFrozen, coverFrozen, coverHeld, homeHeld, paid, excluded, completed] = await Promise.all([
    logs(CHAINS.home, env.HOME_GUARD, T.Inbound),
    logs(CHAINS.home, env.HOME_GUARD, T.GuardFrozen),
    logs(CHAINS.home, env.COVER, T.GuardFrozen),
    logs(CHAINS.home, env.COVER, T.GuardHeld),
    logs(CHAINS.home, env.HOME_GUARD, T.GuardHeld),
    logs(CHAINS.home, env.COVER, T.PolicyPaid),
    logs(CHAINS.home, env.COVER, T.PolicyExcluded),
    logs(CHAINS.home, env.COVER, T.PayoutCompleted),
  ]);
  const [spokeFrozen, quarantines, minted] = await Promise.all([
    logs(CHAINS.spoke, env.SPOKE_A_GUARD, T.GuardFrozen),
    logs(CHAINS.spoke, env.SPOKE_A_GUARD, T.AccountQuarantine),
    logs(CHAINS.spoke, env.SPOKE_A_GUARD, T.Inbound),
  ]);

  p("# Noether evidence");
  p(`Generated ${new Date().toISOString()} from raw logs (last ${LOOKBACK} blocks per chain).`);
  p();
  p(`Hyperlane Warp Route: HypERC20Collateral ${env.HOME_ROUTER} (Base Sepolia) <-> HypERC20 ${env.SPOKE_A} (Unichain Sepolia)`);
  p(`Noether ledger (Lasna) ${env.LEDGER} | guards ${env.HOME_GUARD} (Base), ${env.SPOKE_A_GUARD} (Unichain) | cover ${env.COVER}`);
  p();

  if (raised.length) {
    p("## Suspects raised on Lasna");
    for (const l of raised) {
      const w = words(l.data);
      const logit = BigInt.asIntN(256, w[5]);
      p(`- ${l.topics[1].slice(0, 10)}… amount ${fmt(w[4])} to ${addr(w[3])}, scorer logit ${(Number(logit) / 1e6).toFixed(2)} (p≈${Number(w[6]) / 100}%) | [Lasna tx](${CHAINS.lasna.tx}${l.transactionHash})`);
    }
    p();
  }
  if (cleared.length) {
    p(`## Suspects auto-cleared: ${cleared.length}`);
    p();
  }

  if (!broken.length) {
    p("No conservation-law violation in range. Run `bash script/demo.sh attack` first.");
    writeFileSync("deployments/evidence.md", out.join("\n"));
    return;
  }

  for (const b of broken) {
    const w = words(b.data);
    const incident = b.topics[1];
    const originTx = hex32(w[2]);
    const lasnaTs = await timestampOf(CHAINS.lasna, b.blockNumber);
    p(`## Incident ${incident}`);
    p(`Reason **${REASONS[Number(w[0])]}** on chain ${w[1]}: ${fmt(w[4])} delivered to ${addr(w[3])}. Ledger at detection: escrowed ${fmt(w[5])}, circulating ${fmt(w[6])}.`);
    p();
    p("| Step | Chain | When (UTC) | +s from origin | Tx |");
    p("|---|---|---|---|---|");

    const same = (m) => m.transactionHash.toLowerCase() === originTx.toLowerCase();
    const spokeOrigin = minted.find(same);
    const homeOrigin = homeInbound.find(same);
    const origin = spokeOrigin || homeOrigin;
    const originChain = spokeOrigin ? CHAINS.spoke : CHAINS.home;
    let originTs = origin ? await timestampOf(originChain, origin.blockNumber) : undefined;
    const fz = (list) => list.find((l) => l.topics[1] === incident);
    const rows = [];
    if (origin) rows.push([`1. Forged message processed by Hyperlane Mailbox (${spokeOrigin ? "unbacked mint" : "unbacked release"})`, originChain, originTs, origin.transactionHash]);
    rows.push(["2. Noether reacts: law broken", CHAINS.lasna, lasnaTs, b.transactionHash]);
    for (const [label, chain, list] of [
      ["3. Unichain route frozen (NoetherIsm)", CHAINS.spoke, spokeFrozen],
      ["3. Base route frozen (NoetherIsm)", CHAINS.home, homeFrozen],
      ["3. Cover sales closed + payout opened", CHAINS.home, coverFrozen],
    ]) {
      const ev = fz(list);
      if (!ev) continue;
      const ew = words(ev.data);
      originTs ??= Number(ew[2]);
      rows.push([label, chain, Number(ew[3]), ev.transactionHash]);
    }
    const q = quarantines.filter((l) => l.topics[1] === incident);
    for (const ev of q) rows.push([`3. Quarantined ${addr(BigInt(ev.topics[2])).slice(0, 10)}…`, CHAINS.spoke, Number(words(ev.data)[1]), ev.transactionHash]);
    for (const ev of completed.filter((l) => l.topics[1] === incident)) {
      rows.push([`4. Payout completed (${fmt(words(ev.data)[0])} ETH)`, CHAINS.home, await timestampOf(CHAINS.home, ev.blockNumber), ev.transactionHash]);
    }
    for (const [label, chain, ts, tx] of rows) {
      // Chains keep separate clocks (~1 s granularity), so a step can carry a timestamp a second "before" its cause.
      const d = originTs === undefined ? "" : ts - originTs < 0 ? `${ts - originTs} (clock skew)` : `+${ts - originTs}`;
      p(`| ${label} | ${chain.name} | ${iso(ts)} | ${d} | [${tx.slice(0, 12)}…](${chain.tx}${tx}) |`);
    }
    p();
    const fanout = sent.filter((l) => l.transactionHash === b.transactionHash);
    p(`Callbacks requested in that single reactive transaction: **${fanout.length}** (multi-destination fan-out).`);
    const paidHere = paid.filter((l) => BigInt(words(l.data)[2]) === BigInt(originTs ?? -1)).length;
    const exHere = excluded.length;
    p(`Policies paid automatically for this incident: **${paidHere}**. Policies excluded in range (bought at or after a forged event): **${exHere}**.`);
    if (taints.length) p(`Taint hops traced and quarantined: **${taints.length}**.`);
    p();
  }

  if (coverHeld.length || homeHeld.length) p(`Precautionary holds landed: ${homeHeld.length} on the vault, ${coverHeld.length} on cover.`);
  writeFileSync("deployments/evidence.md", out.join("\n"));
  console.log("\nWritten to deployments/evidence.md");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
