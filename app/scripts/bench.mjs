// Noether live benchmark: repeated forged-mint attacks and honest transfers on the real testnets, measured
// from on-chain data only.
//
//   node app/scripts/bench.mjs [cycles=30]          (needs the operator server: PORT=5175 node app/server.mjs)
//
// One cycle = 1-2 honest transfers, then a forged mint (attack), then a copycat attempt, then a governance
// resolve. The actions go through the local operator server, exactly like the Observatory's buttons.
//
// Latency per attack comes from block timestamps (each chain's own clock, 1 s granularity):
//   origin   = Unichain block of the forged Mailbox.process
//   decision = Lasna block of ConservationBroken
//   landed   = GuardFrozen.landedAt on each guard (Base, Unichain), cover, and the quarantine
// A secondary "observer" number is wall-clock time from the forged receipt until both guards read frozen
// through public RPCs (polled every 500 ms, so it includes RPC lag).
//
// Writes deployments/bench/runs.jsonl (one line per attack or honest transfer, with every tx hash).
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEventLogs, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ledgerAbi, guardAbi, coverAbi, mailboxAbi, ATTACKER } from "../shared/abi.js";

const root = new URL("../../", import.meta.url);
function loadEnv(p) {
  const f = new URL(p, root);
  if (!existsSync(f)) return {};
  const out = {};
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...loadEnv(".env"), ...loadEnv("deployments/testnet.env"), ...process.env };
const SERVER = env.BENCH_SERVER || "http://127.0.0.1:5175";
const CYCLES = Number(process.argv[2] || 30);
const OUT_DIR = new URL("deployments/bench/", root);
mkdirSync(OUT_DIR, { recursive: true });
const OUT = new URL("runs.jsonl", OUT_DIR);

const chains = {
  base: defineChain({ id: 84532, name: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"] } } }),
  unichain: defineChain({ id: 1301, name: "Unichain Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.UNICHAIN_SEPOLIA_RPC || "https://unichain-sepolia-rpc.publicnode.com"] } } }),
  lasna: defineChain({ id: 5318007, name: "Reactive Lasna", nativeCurrency: { name: "REACT", symbol: "REACT", decimals: 18 }, rpcUrls: { default: { http: [env.LASNA_RPC || "https://lasna-rpc.rnk.dev/"] } } }),
};
const pub = Object.fromEntries(Object.entries(chains).map(([k, c]) => [k, createPublicClient({ chain: c, transport: http(undefined, { retryCount: 6, retryDelay: 800, timeout: 20_000 }) })]));
const A = { ledger: env.LEDGER, baseGuard: env.HOME_GUARD, uniGuard: env.SPOKE_A_GUARD, cover: env.COVER };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

async function retry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; await sleep(1000 * (i + 1)); }
  }
}

// Runs an operator action through the local server and returns its streamed lines.
async function action(name, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SERVER}/api/action/${name}`, { method: "POST", headers: { "x-noether": "1", "content-type": "application/json" }, body: JSON.stringify(opts) });
    if (res.status === 409 && attempt < 30) { await sleep(2000); continue; }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
    const lines = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const err = lines.find((l) => l.kind === "error");
    if (err) throw new Error(`${name}: ${err.text}`);
    return lines;
  }
}
const txOf = (lines, re) => lines.find((l) => l.kind === "tx" && l.status === "confirmed" && re.test(l.label));

// eth_getLogs in chunks (Base Sepolia caps the range; 200 ms blocks).
async function logs(chain, address, abi, eventName, from, to) {
  const step = chain === "base" ? 190n : 900n;
  const out = [];
  for (let a = from; a <= to; a += step + 1n) {
    const b = a + step > to ? to : a + step;
    const raw = await retry(() => pub[chain].getLogs({ address, fromBlock: a, toBlock: b }));
    out.push(...parseEventLogs({ abi, logs: raw, eventName, strict: false }));
  }
  return out;
}
const heads = async () => Object.fromEntries(await Promise.all(Object.keys(pub).map(async (k) => [k, await retry(() => pub[k].getBlockNumber())])));
const blockTs = async (chain, n) => Number((await retry(() => pub[chain].getBlock({ blockNumber: n }))).timestamp);
const read = (chain, address, abi, functionName, args = []) => retry(() => pub[chain].readContract({ address, abi, functionName, args }));

async function waitFor(cond, timeoutS, label) {
  const t0 = now();
  while (now() - t0 < timeoutS) {
    if (await cond()) return now() - t0;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// Keep the ledger funded: top it up from the operator wallet if its REACT balance runs low.
async function keepLedgerFunded() {
  const bal = await retry(() => pub.lasna.getBalance({ address: A.ledger }));
  if (bal >= parseEther("0.8")) return;
  if (!env.PRIVATE_KEY) throw new Error("ledger below 0.8 REACT and no key to top it up");
  const account = privateKeyToAccount(env.PRIVATE_KEY.startsWith("0x") ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`);
  const w = createWalletClient({ account, chain: chains.lasna, transport: http() });
  const hash = await w.sendTransaction({ to: A.ledger, value: parseEther("1"), type: "legacy", gasPrice: await pub.lasna.getGasPrice() });
  await pub.lasna.waitForTransactionReceipt({ hash });
  console.log(`  topped up ledger with 1 REACT (${hash})`);
}

async function ensureNormal() {
  const mode = await read("lasna", A.ledger, ledgerAbi, "mode");
  const frozen = (await read("base", A.baseGuard, guardAbi, "frozen")) || (await read("unichain", A.uniGuard, guardAbi, "frozen"));
  if (mode !== 0 || frozen) {
    await action("resolve");
    await waitFor(async () => (await read("lasna", A.ledger, ledgerAbi, "mode")) === 0, 180, "ledger NORMAL");
  }
}

function record(row) {
  appendFileSync(OUT, JSON.stringify(row) + "\n");
}

async function honest(cycle) {
  const h = await heads();
  const before = { esc: await read("lasna", A.ledger, ledgerAbi, "escrowed"), circ: await read("lasna", A.ledger, ledgerAbi, "circulating") };
  const lines = await action("honest", { amount: "100" });
  const dispatch = txOf(lines, /transferRemote/);
  const delivery = txOf(lines, /honest relay/);
  const amt = parseEther("100");
  // both halves accounted on Lasna
  const matched = await waitFor(async () => {
    const [esc, circ] = [await read("lasna", A.ledger, ledgerAbi, "escrowed"), await read("lasna", A.ledger, ledgerAbi, "circulating")];
    return esc >= before.esc + amt && circ >= before.circ + amt;
  }, 180, "honest transfer accounted").catch(() => null);
  await sleep(9000); // past the 5-Lasna-block grace window
  const h2 = await heads();
  const [raised, cleared, broken] = await Promise.all([
    logs("lasna", A.ledger, ledgerAbi, "SuspectRaised", h.lasna, h2.lasna),
    logs("lasna", A.ledger, ledgerAbi, "SuspectCleared", h.lasna, h2.lasna),
    logs("lasna", A.ledger, ledgerAbi, "ConservationBroken", h.lasna, h2.lasna),
  ]);
  const mode = await read("lasna", A.ledger, ledgerAbi, "mode");
  const row = {
    kind: "honest", cycle, at: new Date().toISOString(), amount: 100,
    dispatchTx: dispatch?.hash, deliveryTx: delivery?.hash, matched: matched !== null,
    suspectsRaised: raised.length, suspectsCleared: cleared.length, falseFreeze: broken.length > 0 || mode === 2, modeAfter: mode,
  };
  record(row);
  console.log(`  honest: matched=${row.matched} suspects ${row.suspectsRaised}/${row.suspectsCleared} cleared, false freeze=${row.falseFreeze}`);
  if (row.falseFreeze) await ensureNormal();
  return row;
}

async function attack(cycle, amount) {
  const h = await heads();
  const lines = await action("attack", { amount: String(amount), frontrun: false });
  const forged = txOf(lines, /FORGED/);
  if (!forged) throw new Error("no forged tx in attack stream");
  const tForged = now();
  let observer = null;
  try {
    observer = await waitFor(async () => (await read("base", A.baseGuard, guardAbi, "frozen")) && (await read("unichain", A.uniGuard, guardAbi, "frozen")), 600, "both guards frozen");
  } catch (e) { console.log("  " + e.message); }
  const observerS = observer === null ? null : +(now() - tForged).toFixed(2);
  await sleep(4000); // let the quarantine and cover callbacks land too
  // copycat: a second forged message must now be rejected by the frozen ISM
  let copycat = "skipped";
  try {
    const cl = await action("copycat");
    copycat = cl.some((l) => /rejected/.test(l.text || "")) ? "rejected" : cl.some((l) => /accepted/.test(l.text || "")) ? "ACCEPTED" : "unknown";
  } catch (e) { copycat = "error: " + e.message.slice(0, 80); }
  const h2 = await heads();
  const originBlock = (await retry(() => pub.unichain.getTransactionReceipt({ hash: forged.hash }))).blockNumber;
  const originTs = await blockTs("unichain", originBlock);
  const [broken, sent, baseF, coverF, uniF, quar] = await Promise.all([
    logs("lasna", A.ledger, ledgerAbi, "ConservationBroken", h.lasna, h2.lasna),
    logs("lasna", A.ledger, ledgerAbi, "CallbackSent", h.lasna, h2.lasna),
    logs("base", A.baseGuard, guardAbi, "GuardFrozen", h.base, h2.base),
    logs("base", A.cover, guardAbi, "GuardFrozen", h.base, h2.base),
    logs("unichain", A.uniGuard, guardAbi, "GuardFrozen", h.unichain, h2.unichain),
    logs("unichain", A.uniGuard, guardAbi, "AccountQuarantine", h.unichain, h2.unichain),
  ]);
  const brk = broken.find((l) => BigInt(l.args.originTxHash) === BigInt(forged.hash));
  const id = brk?.args.incidentId;
  const of = (list) => list.find((l) => l.args.incidentId === id);
  const decisionTs = brk ? await blockTs("lasna", brk.blockNumber) : null;
  const landed = (l) => (l ? Number(l.args.landedAt) : null);
  const row = {
    kind: "attack", cycle, at: new Date().toISOString(), amount,
    forgedTx: forged.hash, originTs,
    lasnaTx: brk?.transactionHash ?? null, reason: brk ? Number(brk.args.reason) : null, decisionTs,
    callbacks: brk ? sent.filter((l) => l.transactionHash === brk.transactionHash).length : 0,
    baseFrozenTx: of(baseF)?.transactionHash ?? null, baseFrozenTs: landed(of(baseF)),
    uniFrozenTx: of(uniF)?.transactionHash ?? null, uniFrozenTs: landed(of(uniF)),
    coverTx: of(coverF)?.transactionHash ?? null, coverTs: landed(of(coverF)),
    quarantineTx: of(quar)?.transactionHash ?? null, quarantineTs: landed(of(quar)),
    observerS, copycat,
  };
  row.decisionS = decisionTs === null ? null : decisionTs - originTs;
  row.baseS = row.baseFrozenTs === null ? null : row.baseFrozenTs - originTs;
  row.uniS = row.uniFrozenTs === null ? null : row.uniFrozenTs - originTs;
  row.bothS = row.baseS === null || row.uniS === null ? null : Math.max(row.baseS, row.uniS);
  record(row);
  console.log(`  attack ${amount}: decision ${row.decisionS}s, Base +${row.baseS}s, Unichain +${row.uniS}s, callbacks ${row.callbacks}, observer ${observerS}s, copycat ${copycat}`);
  // governance resolve, then back to NORMAL with both guards open
  await action("resolve");
  await waitFor(async () => (await read("lasna", A.ledger, ledgerAbi, "mode")) === 0
    && !(await read("base", A.baseGuard, guardAbi, "frozen")) && !(await read("unichain", A.uniGuard, guardAbi, "frozen"))
    && !(await read("unichain", A.uniGuard, guardAbi, "quarantined", [ATTACKER])), 300, "resolved");
  return row;
}

async function main() {
  console.log(`Noether benchmark: ${CYCLES} cycles → ${OUT.pathname}`);
  await ensureNormal();
  for (let c = 1; c <= CYCLES; c++) {
    console.log(`cycle ${c}/${CYCLES}`);
    try {
      await keepLedgerFunded();
      for (let k = 0; k < (c % 2 ? 1 : 2); k++) await honest(c);
      // mostly whale forgeries (neural path); every third cycle a small one (1,000) to exercise the other path
      await attack(c, c % 3 === 0 ? 1000 : 1000000);
    } catch (e) {
      console.log(`  cycle ${c} failed: ${e.message}`);
      record({ kind: "error", cycle: c, at: new Date().toISOString(), error: String(e.message).slice(0, 300) });
      await ensureNormal().catch(() => {});
    }
  }
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
