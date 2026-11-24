// Noether Observatory server.
//
//   node server.mjs --dev   Vite dev server + API on http://127.0.0.1:5173
//   node server.mjs         serves the production build in dist/
//
// Roles:
//   /api/config        public addresses and explorer links (from deployments/testnet.env)
//   /rpc/:chain        read-only JSON-RPC proxy to Base Sepolia, Unichain Sepolia and Reactive Lasna
//   /api/action/:name  OPERATOR ONLY: runs a live scenario with the key in ../.env and streams progress
//
// Safety: the private key never leaves this process; it is never sent to the browser. The server binds to
// 127.0.0.1, actions require same-origin requests with an `x-noether` header, run one at a time, and can
// be disabled with NOETHER_OPERATOR=0 (watch-only mode, for a public deployment).
import http from "node:http";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  parseEther,
  parseEventLogs,
  pad,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ledgerAbi, guardAbi, coverAbi, mailboxAbi, routerAbi, erc20Abi, forgeMessage, ATTACKER } from "./shared/abi.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const DEV = process.argv.includes("--dev");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = { ...loadEnv(join(root, ".env")), ...loadEnv(join(root, "deployments", "testnet.env")), ...process.env };
const need = ["HOME_ROUTER", "SPOKE_A", "LEDGER", "HOME_GUARD", "SPOKE_A_GUARD", "COVER", "HOME_MAILBOX", "SPOKE_A_MAILBOX", "DUSD"];
for (const k of need) if (!env[k]) throw new Error(`deployments/testnet.env is missing ${k}; run script/deploy.sh first`);

const chains = {
  base: defineChain({ id: 84532, name: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"] } } }),
  unichain: defineChain({ id: 1301, name: "Unichain Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.UNICHAIN_SEPOLIA_RPC || "https://unichain-sepolia-rpc.publicnode.com"] } } }),
  lasna: defineChain({ id: 5318007, name: "Reactive Lasna", nativeCurrency: { name: "REACT", symbol: "REACT", decimals: 18 }, rpcUrls: { default: { http: [env.LASNA_RPC || "https://lasna-rpc.rnk.dev/"] } } }),
};

const operatorOn = process.env.NOETHER_OPERATOR !== "0" && /^0x[0-9a-fA-F]{64}$/.test(env.PRIVATE_KEY || "");
const account = operatorOn ? privateKeyToAccount(env.PRIVATE_KEY) : null;

const pub = Object.fromEntries(Object.entries(chains).map(([k, c]) => [k, createPublicClient({ chain: c, transport: viemHttp() })]));
const wal = account
  ? Object.fromEntries(Object.entries(chains).map(([k, c]) => [k, createWalletClient({ account, chain: c, transport: viemHttp() })]))
  : null;

const config = {
  operator: operatorOn,
  operatorAddress: account?.address ?? null,
  attacker: ATTACKER,
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
    monitor: env.MONITOR || null,
  },
};

// ------------------------------------------------------------------ live scenarios

const C = config.contracts;
let busy = false;

async function send(chainKey, params, label, emit) {
  // Lasna suggests a 0 priority fee via eth_maxPriorityFeePerGas but rejects tips below 1 wei, so
  // EIP-1559 transactions from viem's defaults fail there. Legacy transactions at eth_gasPrice work.
  if (chainKey === "lasna") params = { ...params, type: "legacy", gasPrice: await pub.lasna.getGasPrice() };
  const hash = await wal[chainKey].writeContract(params);
  emit({ kind: "tx", chain: chainKey, label, hash, status: "sent" });
  const r = await pub[chainKey].waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
  emit({ kind: "tx", chain: chainKey, label, hash, status: "confirmed", block: Number(r.blockNumber) });
  return r;
}

const nonce32 = () => 900_000_000 + Math.floor(Math.random() * 99_000_000);

const actions = {
  async honest(emit, { amount = "1000" } = {}) {
    const me = account.address;
    const amt = parseEther(String(amount));
    const bal = await pub.base.readContract({ address: C.dusd, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    if (bal < amt) await send("base", { address: C.dusd, abi: erc20Abi, functionName: "faucet" }, "dUSD faucet", emit);
    const allowance = await pub.base.readContract({ address: C.dusd, abi: erc20Abi, functionName: "allowance", args: [me, C.homeRouter] });
    if (allowance < amt) {
      await send("base", { address: C.dusd, abi: erc20Abi, functionName: "approve", args: [C.homeRouter, 2n ** 255n] }, "Approve warp router", emit);
    }
    const fee = await pub.base.readContract({ address: C.homeRouter, abi: routerAbi, functionName: "quoteGasPayment", args: [1301] });
    const r = await send(
      "base",
      { address: C.homeRouter, abi: routerAbi, functionName: "transferRemote", args: [1301, pad(me), amt], value: fee },
      `transferRemote ${amount} dUSD → Unichain`,
      emit,
    );
    const dispatch = parseEventLogs({ abi: mailboxAbi, logs: r.logs, eventName: "Dispatch" }).find(
      (l) => l.address.toLowerCase() === C.homeMailbox.toLowerCase(),
    );
    if (!dispatch) throw new Error("no Dispatch in receipt");
    emit({ kind: "note", text: "Hyperlane message dispatched. Relaying it as the route's trusted relayer…" });
    await send("unichain", { address: C.spokeMailbox, abi: mailboxAbi, functionName: "process", args: ["0x", dispatch.args.message] }, "Mailbox.process on Unichain (honest relay)", emit);
    emit({ kind: "done", text: `Delivered: ${amount} ndUSD minted on Unichain. Noether should match it and stay NORMAL.` });
  },

  async attack(emit, { amount = "1000000", frontrun = true } = {}) {
    const message = forgeMessage({
      nonce: nonce32(),
      origin: 84532,
      sender: C.homeRouter,
      destination: 1301,
      recipient: C.spokeRouter,
      to: ATTACKER,
      amount: parseEther(String(amount)),
    });
    emit({ kind: "note", text: `Forging a ${Number(amount).toLocaleString()} ndUSD message "from" the Base router with the compromised relayer key.` });
    await send("unichain", { address: C.spokeMailbox, abi: mailboxAbi, functionName: "process", args: ["0x", message] }, "FORGED Mailbox.process on Unichain", emit);
    emit({ kind: "alarm", text: "Hyperlane accepted the forged message: unbacked supply minted. Noether is reacting on Lasna." });
    if (frontrun) {
      const cov = parseEther("0.001");
      try {
        const premium = await pub.base.readContract({ address: C.cover, abi: coverAbi, functionName: "premiumFor", args: [cov] });
        await send("base", { address: C.cover, abi: coverAbi, functionName: "buyCover", args: [cov], value: premium }, "Front-runner buys cover", emit);
        emit({ kind: "note", text: "The front-runner's policy landed before the hold, so it is bought after the forged mint and will be EXCLUDED from payout." });
      } catch (e) {
        emit({ kind: "note", text: "Front-runner's buyCover rejected: sales already closed." });
      }
    }
    emit({ kind: "done", text: "Attack submitted. Watch the freezes land." });
  },

  async drain(emit, { amount = "100" } = {}) {
    const message = forgeMessage({
      nonce: nonce32(),
      origin: 1301,
      sender: C.spokeRouter,
      destination: 84532,
      recipient: C.homeRouter,
      to: ATTACKER,
      amount: parseEther(String(amount)),
    });
    emit({ kind: "note", text: `Forging a "burn" message from the Unichain router to release ${amount} dUSD of collateral on Base.` });
    await send("base", { address: C.homeMailbox, abi: mailboxAbi, functionName: "process", args: ["0x", message] }, "FORGED Mailbox.process on Base", emit);
    emit({ kind: "alarm", text: "Collateral released with nothing burned. Noether is reacting on Lasna." });
    emit({ kind: "done", text: "Drain submitted. Copycats should now be rejected by the frozen ISM." });
  },

  async copycat(emit) {
    const message = forgeMessage({
      nonce: nonce32(),
      origin: 84532,
      sender: C.homeRouter,
      destination: 1301,
      recipient: C.spokeRouter,
      to: ATTACKER,
      amount: parseEther("1000000"),
    });
    try {
      await send("unichain", { address: C.spokeMailbox, abi: mailboxAbi, functionName: "process", args: ["0x", message] }, "Second forged message", emit);
      emit({ kind: "alarm", text: "Second forged message was accepted: the route is not frozen yet." });
    } catch (e) {
      emit({ kind: "done", text: "Second forged message rejected by Hyperlane's Mailbox: ISM verification failed (route frozen by Noether)." });
    }
  },

  async resolve(emit) {
    const mode = await pub.lasna.readContract({ address: C.ledger, abi: ledgerAbi, functionName: "mode" });
    if (mode === 2) await send("lasna", { address: C.ledger, abi: ledgerAbi, functionName: "resolveIncident" }, "Ledger.resolveIncident (Lasna)", emit);
    for (const [chain, addr, label] of [
      ["base", C.homeGuard, "Base guard"],
      ["base", C.cover, "Cover pool"],
      ["unichain", C.spokeGuard, "Unichain guard"],
    ]) {
      const [frozen, held] = await Promise.all([
        pub[chain].readContract({ address: addr, abi: guardAbi, functionName: "frozen" }),
        pub[chain].readContract({ address: addr, abi: guardAbi, functionName: "held" }),
      ]);
      if (frozen || held) await send(chain, { address: addr, abi: guardAbi, functionName: "resolve" }, `${label}.resolve()`, emit);
    }
    const q = await pub.unichain.readContract({ address: C.spokeGuard, abi: guardAbi, functionName: "quarantined", args: [ATTACKER] });
    if (q) await send("unichain", { address: C.spokeGuard, abi: guardAbi, functionName: "clearQuarantine", args: [ATTACKER] }, "Clear attacker quarantine", emit);
    emit({ kind: "done", text: "Governance resolution complete: route open, ledger NORMAL." });
  },
};

// ------------------------------------------------------------------ http

const RPC_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getLogs",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);
const upstream = Object.fromEntries(Object.entries(chains).map(([k, c]) => [k, c.rpcUrls.default.http[0]]));

// Shared response cache + in-flight de-duplication, so any number of viewers costs roughly one viewer's
// worth of upstream traffic. Head-dependent reads live 1.5 s; immutable history lives 10 minutes.
const cache = new Map(); // key -> { exp, value }
const inflight = new Map(); // key -> Promise<{ result } | { error }>

function ttlFor(c) {
  const p = c.params || [];
  if (c.method === "eth_chainId") return 3_600_000;
  if (c.method === "eth_getLogs") return p[0]?.toBlock && p[0].toBlock !== "latest" ? 600_000 : 1_500;
  if (c.method === "eth_getBlockByNumber") return p[0] === "latest" ? 1_500 : 600_000;
  if (c.method === "eth_getTransactionReceipt" || c.method === "eth_getTransactionByHash") return 600_000;
  return 1_500;
}

async function upstreamBatch(chain, calls) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params ?? [] }));
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(upstream[chain], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 400 * 2 ** attempt));
      continue;
    }
    const data = await r.json();
    const arr = Array.isArray(data) ? data : [data];
    const byId = new Map(arr.map((x) => [x.id, x]));
    return calls.map((_, i) => byId.get(i + 1) ?? { error: { code: -32603, message: `upstream HTTP ${r.status}` } });
  }
}

async function cachedRpc(chain, calls) {
  const now = Date.now();
  const out = new Array(calls.length);
  const missing = [];
  const waits = [];
  calls.forEach((c, i) => {
    const key = `${chain}|${c.method}|${JSON.stringify(c.params ?? [])}`;
    const hit = cache.get(key);
    if (hit && hit.exp > now) out[i] = { result: hit.value };
    else if (inflight.has(key)) waits.push(inflight.get(key).then((v) => (out[i] = v)));
    else missing.push({ i, c, key });
  });
  if (missing.length) {
    const p = upstreamBatch(chain, missing.map((m) => m.c));
    missing.forEach((m, k) => {
      const one = p.then((res) => {
        const x = res[k];
        inflight.delete(m.key);
        if (!x.error && x.result !== null && x.result !== undefined) cache.set(m.key, { exp: Date.now() + ttlFor(m.c), value: x.result });
        return x.error ? { error: x.error } : { result: x.result };
      });
      one.catch(() => inflight.delete(m.key));
      inflight.set(m.key, one);
      waits.push(one.then((v) => (out[m.i] = v)));
    });
  }
  await Promise.all(waits);
  if (cache.size > 20_000) for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
      if (s.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  return [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(o);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/config") return json(res, 200, config), true;

  const rpc = url.pathname.match(/^\/rpc\/(base|unichain|lasna)$/);
  if (rpc && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.every((c) => RPC_METHODS.has(c.method))) return json(res, 403, { error: "method not allowed" }), true;
    const results = await cachedRpc(rpc[1], calls);
    const reply = results.map((x, i) => ({ jsonrpc: "2.0", id: calls[i].id, ...x }));
    return json(res, 200, Array.isArray(body) ? reply : reply[0]), true;
  }

  const act = url.pathname.match(/^\/api\/action\/(honest|attack|drain|copycat|resolve)$/);
  if (act && req.method === "POST") {
    if (!operatorOn) return json(res, 403, { error: "watch-only mode: no operator key on this server" }), true;
    if (!sameOrigin(req) || req.headers["x-noether"] !== "1") return json(res, 403, { error: "cross-origin action refused" }), true;
    if (busy) return json(res, 409, { error: "another action is running" }), true;
    const opts = JSON.parse((await readBody(req)) || "{}");
    busy = true;
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
    const emit = (e) => res.write(JSON.stringify({ t: Date.now(), ...e }) + "\n");
    try {
      emit({ kind: "start", action: act[1] });
      await actions[act[1]](emit, opts);
    } catch (e) {
      emit({ kind: "error", text: [e.shortMessage || e.message || String(e), e.details].filter(Boolean).join(" · ").slice(0, 400) });
    } finally {
      busy = false;
      res.end();
    }
    return true;
  }

  if (url.pathname === "/api/operator" && operatorOn) {
    const me = account.address;
    const [b, u, l] = await Promise.all([pub.base.getBalance({ address: me }), pub.unichain.getBalance({ address: me }), pub.lasna.getBalance({ address: me })]);
    return json(res, 200, { address: me, base: formatEther(b), unichain: formatEther(u), lasna: formatEther(l) }), true;
  }
  return false;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };

async function main() {
  let vite;
  const dist = join(here, "dist");
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/") || req.url.startsWith("/rpc/")) {
        if (await handleApi(req, res)) return;
        return json(res, 404, { error: "not found" });
      }
      if (vite) return vite.middlewares(req, res);
      let p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) p = join(dist, "index.html");
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
      createReadStream(p).pipe(res);
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
      else res.end();
    }
  });
  if (DEV) {
    const { createServer } = await import("vite");
    // Hot reload rides on this same HTTP server, so the browser's websocket has somewhere to connect.
    vite = await createServer({ root: here, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  }
  server.listen(PORT, HOST, () => {
    console.log(`Noether Observatory on http://${HOST}:${PORT}  (${operatorOn ? `operator: ${account.address}` : "watch-only"})`);
  });
}

main();
