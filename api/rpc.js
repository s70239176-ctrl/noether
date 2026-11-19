// Vercel serverless: read-only JSON-RPC proxy for the Observatory (reached as /rpc/:chain).
// Same method whitelist as app/server.mjs; a per-instance cache with in-flight de-duplication keeps the
// public RPCs from being hammered when many people watch at once. It can never send a transaction.
const UPSTREAM = {
  base: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  unichain: process.env.UNICHAIN_SEPOLIA_RPC || "https://unichain-sepolia-rpc.publicnode.com",
  lasna: process.env.LASNA_RPC || "https://lasna-rpc.rnk.dev/",
};

const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getLogs",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);

const cache = new Map();
const inflight = new Map();

function ttlFor(c) {
  const p = c.params || [];
  if (c.method === "eth_chainId") return 3_600_000;
  if (c.method === "eth_getLogs") return p[0] && p[0].toBlock && p[0].toBlock !== "latest" ? 600_000 : 1_500;
  if (c.method === "eth_getBlockByNumber") return p[0] === "latest" ? 1_500 : 600_000;
  if (c.method === "eth_getTransactionReceipt" || c.method === "eth_getTransactionByHash") return 600_000;
  return 1_500;
}

async function upstreamBatch(chain, calls) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params || [] }));
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(UPSTREAM[chain], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 400 * 2 ** attempt));
      continue;
    }
    const data = await r.json();
    const arr = Array.isArray(data) ? data : [data];
    const byId = new Map(arr.map((x) => [x.id, x]));
    return calls.map((_, i) => byId.get(i + 1) || { error: { code: -32603, message: `upstream HTTP ${r.status}` } });
  }
}

async function cachedRpc(chain, calls) {
  const now = Date.now();
  const out = new Array(calls.length);
  const missing = [];
  const waits = [];
  calls.forEach((c, i) => {
    const key = `${chain}|${c.method}|${JSON.stringify(c.params || [])}`;
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

module.exports = async (req, res) => {
  const chain = String((req.query && req.query.chain) || "");
  if (!UPSTREAM[chain]) return res.status(404).json({ error: "unknown chain" });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body = req.body;
  if (typeof body === "string") body = JSON.parse(body);
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 50 || !calls.every((c) => c && ALLOWED.has(c.method))) {
    return res.status(403).json({ error: "method not allowed" });
  }
  try {
    const results = await cachedRpc(chain, calls);
    const reply = results.map((x, i) => ({ jsonrpc: "2.0", id: calls[i].id, ...x }));
    res.status(200).json(Array.isArray(body) ? reply : reply[0]);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
