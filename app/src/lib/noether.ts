// Live data layer: polls Base Sepolia, Unichain Sepolia and Reactive Lasna through the local RPC proxy,
// reads Noether's state and decodes every event the loop produces.
import { useEffect, useRef, useState } from "react";
import { createPublicClient, http, parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from "viem";
// @ts-ignore shared JS module
import { ledgerAbi, guardAbi, coverAbi, mailboxAbi, routerAbi, erc20Abi, monitorAbi } from "../../shared/abi.js";

export type ChainKey = "base" | "unichain" | "lasna";

export interface Config {
  operator: boolean;
  operatorAddress: Address | null;
  attacker: Address;
  chains: Record<ChainKey, { id: number; name: string; tx: string; address: string }>;
  contracts: {
    ledger: Address;
    homeMailbox: Address;
    homeRouter: Address;
    homeGuard: Address;
    cover: Address;
    dusd: Address;
    spokeMailbox: Address;
    spokeRouter: Address;
    spokeGuard: Address;
    monitor: Address | null;
  };
}

export interface LiveState {
  mode: number;
  locked: bigint;
  released: bigint;
  minted: bigint;
  burned: bigint;
  escrowed: bigint;
  circulating: bigint;
  clockOn: boolean;
  openSuspects: number;
  tainted: number;
  incidents: number;
  grace: number;
  ledgerReact: bigint;
  homeFrozen: boolean;
  homeHeld: boolean;
  spokeFrozen: boolean;
  coverFrozen: boolean;
  coverHeld: boolean;
  attackerQuarantined: boolean;
  capital: bigint;
  outstanding: bigint;
  totalPaid: bigint;
  policies: number;
  vaultCollateral: bigint;
  spokeSupply: bigint;
  routes: MonitoredRoute[];
  monitorOpen: number;
}

export interface MonitoredRoute {
  id: number;
  name: string;
  chainA: number;
  chainB: number;
  routerA: Address;
  routerB: Address;
  escrowed: bigint;
  circulating: bigint;
  matched: number;
  unexplained: number;
  unbacked: number;
}

export interface NEvent {
  key: string;
  chain: ChainKey;
  block: number;
  tx: Hex;
  logIndex: number;
  name: string;
  args: Record<string, any>;
  address: Address;
  ts?: number;
  fresh: boolean; // arrived while the page was open (drives animations)
}

// About 30-60 minutes of history on first load. Base Sepolia now makes ~0.2 s blocks; Unichain and Lasna ~1 s.
const LOOKBACK: Record<ChainKey, bigint> = { base: 9000n, unichain: 3600n, lasna: 3600n };
const START_CHUNK: Record<ChainKey, bigint> = { base: 190n, unichain: 900n, lasna: 900n };

// Lasna answers a batch of reads in 1-3 s, so: generous timeouts, and separate transports for state reads
// and log backfill, so a slow history page never delays the live state.
function client(chain: ChainKey, batch: boolean): PublicClient {
  return createPublicClient({
    transport: http(`/rpc/${chain}`, { timeout: 30_000, retryCount: 2, batch: batch ? { batchSize: 24, wait: 16 } : false }),
  }) as PublicClient;
}

export const clients: Record<ChainKey, PublicClient> = { base: client("base", true), unichain: client("unichain", true), lasna: client("lasna", true) };
const logClients: Record<ChainKey, PublicClient> = { base: client("base", false), unichain: client("unichain", false), lasna: client("lasna", false) };

export async function loadConfig(): Promise<Config> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error("config unavailable");
  return r.json();
}

async function readState(cfg: Config): Promise<LiveState> {
  const c = cfg.contracts;
  const L = (fn: string) => clients.lasna.readContract({ address: c.ledger, abi: ledgerAbi as Abi, functionName: fn }) as Promise<any>;
  const g = (chain: ChainKey, address: Address, fn: string, args: any[] = []) =>
    clients[chain].readContract({ address, abi: guardAbi as Abi, functionName: fn, args }) as Promise<any>;
  const cv = (fn: string) => clients.base.readContract({ address: c.cover, abi: coverAbi as Abi, functionName: fn }) as Promise<any>;
  const [mode, locked, released, minted, burned, escrowed, circulating, clockOn, open, tainted, incidents, grace, ledgerReact] = await Promise.all([
    L("mode"),
    L("lockedTotal"),
    L("releasedTotal"),
    L("mintedTotal"),
    L("burnedTotal"),
    L("escrowed"),
    L("circulating"),
    L("clockOn"),
    L("openSuspectCount"),
    L("taintedCount"),
    L("incidentCount"),
    L("graceBlocks"),
    clients.lasna.getBalance({ address: c.ledger }),
  ]);
  const [homeFrozen, homeHeld, coverFrozen, coverHeld, capital, outstanding, totalPaid, nextPolicy, vaultCollateral] = await Promise.all([
    g("base", c.homeGuard, "frozen"),
    g("base", c.homeGuard, "held"),
    g("base", c.cover, "frozen"),
    g("base", c.cover, "held"),
    cv("capital"),
    cv("outstandingCover"),
    cv("totalPaid"),
    cv("nextPolicyId"),
    clients.base.readContract({ address: c.dusd, abi: erc20Abi as Abi, functionName: "balanceOf", args: [c.homeRouter] }) as Promise<bigint>,
  ]);
  const [spokeFrozen, attackerQuarantined, spokeSupply] = await Promise.all([
    g("unichain", c.spokeGuard, "frozen"),
    g("unichain", c.spokeGuard, "quarantined", [cfg.attacker]),
    clients.unichain.readContract({ address: c.spokeRouter, abi: routerAbi as Abi, functionName: "totalSupply" }) as Promise<bigint>,
  ]);
  let routes: MonitoredRoute[] = [];
  let monitorOpen = 0;
  if (c.monitor) {
    const M = (fn: string, args: any[] = []) => clients.lasna.readContract({ address: c.monitor!, abi: monitorAbi as Abi, functionName: fn, args }) as Promise<any>;
    const [count, open] = await Promise.all([M("routeCount"), M("openCount")]);
    monitorOpen = Number(open);
    routes = (await Promise.all(Array.from({ length: Number(count) }, (_, i) => M("route", [BigInt(i)])))).map((r: any, i: number) => ({
      id: i,
      name: r.name,
      chainA: Number(r.chainA),
      chainB: Number(r.chainB),
      routerA: r.routerA,
      routerB: r.routerB,
      escrowed: r.escrowed,
      circulating: r.circulating,
      matched: Number(r.matched),
      unexplained: Number(r.unexplained),
      unbacked: Number(r.unbacked),
    }));
  }
  return {
    routes,
    monitorOpen,
    mode: Number(mode),
    locked,
    released,
    minted,
    burned,
    escrowed,
    circulating,
    clockOn,
    openSuspects: Number(open),
    tainted: Number(tainted),
    incidents: Number(incidents),
    grace: Number(grace),
    ledgerReact,
    homeFrozen,
    homeHeld,
    spokeFrozen,
    coverFrozen,
    coverHeld,
    attackerQuarantined,
    capital,
    outstanding,
    totalPaid,
    policies: Number(nextPolicy) - 1,
    vaultCollateral,
    spokeSupply,
  };
}

/** Which contracts and ABIs to watch on each chain. */
function watchList(cfg: Config): Record<ChainKey, { addresses: Address[]; abi: Abi; filter?: (l: any) => boolean }> {
  const c = cfg.contracts;
  const pad = (a: string) => ("0x" + a.toLowerCase().slice(2).padStart(64, "0")) as Hex;
  return {
    base: {
      addresses: [c.homeMailbox, c.homeGuard, c.cover],
      abi: [...(mailboxAbi as Abi), ...(guardAbi as Abi), ...(coverAbi as Abi)] as Abi,
      // The Base Mailbox is busy with other apps: keep only this route's dispatches.
      filter: (l) => l.address.toLowerCase() !== c.homeMailbox.toLowerCase() || l.topics[1]?.toLowerCase() === pad(c.homeRouter),
    },
    unichain: {
      addresses: [c.spokeMailbox, c.spokeGuard],
      abi: [...(mailboxAbi as Abi), ...(guardAbi as Abi)] as Abi,
      filter: (l) => l.address.toLowerCase() !== c.spokeMailbox.toLowerCase() || l.topics[1]?.toLowerCase() === pad(c.spokeRouter),
    },
    lasna: { addresses: c.monitor ? [c.ledger, c.monitor] : [c.ledger], abi: [...(ledgerAbi as Abi), ...(monitorAbi as Abi)] as Abi },
  };
}

export function useNoether() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [events, setEvents] = useState<NEvent[]>([]);
  const [heads, setHeads] = useState<Partial<Record<ChainKey, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number>(0);
  const cursors = useRef<Partial<Record<ChainKey, bigint>>>({});
  const chunk = useRef<Record<ChainKey, bigint>>({ ...START_CHUNK });
  const seen = useRef<Set<string>>(new Set());
  const tsCache = useRef<Map<string, number>>(new Map());
  const booted = useRef<Record<ChainKey, boolean>>({ base: false, unichain: false, lasna: false });

  useEffect(() => {
    loadConfig().then(setCfg).catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!cfg) return;
    let stop = false;
    const watch = watchList(cfg);

    async function pullLogs(chain: ChainKey) {
      const cl = logClients[chain];
      const head = await cl.getBlockNumber();
      setHeads((h) => ({ ...h, [chain]: Number(head) }));
      const start = cursors.current[chain] ?? (head > LOOKBACK[chain] ? head - LOOKBACK[chain] : 0n);
      const out: NEvent[] = [];
      const fetchRange = async (a: bigint, b: bigint): Promise<any[]> => {
        try {
          return await cl.request({
            method: "eth_getLogs",
            params: [{ address: watch[chain].addresses, fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }],
          } as any);
        } catch (e) {
          if (b - a < 20n) throw e;
          const mid = a + (b - a) / 2n; // provider range cap: split and retry
          if (chunk.current[chain] > 20n) chunk.current[chain] = chunk.current[chain] / 2n;
          return [...(await fetchRange(a, mid)), ...(await fetchRange(mid + 1n, b))];
        }
      };
      // Pages are fetched six at a time (Base Sepolia's ~0.2 s blocks mean many 200-block pages).
      const pages: [bigint, bigint][] = [];
      for (let a = start; a <= head; a += chunk.current[chain] + 1n) {
        pages.push([a, a + chunk.current[chain] > head ? head : a + chunk.current[chain]]);
      }
      const rawAll: any[] = [];
      for (let i = 0; i < pages.length; i += 6) {
        const got = await Promise.all(pages.slice(i, i + 6).map(([a, b]) => fetchRange(a, b)));
        for (const g of got) rawAll.push(...g);
      }
      {
        const raw = rawAll;
        const kept = watch[chain].filter ? raw.filter(watch[chain].filter) : raw;
        const parsed = parseEventLogs({ abi: watch[chain].abi, logs: kept as any, strict: false }) as any[];
        for (const l of parsed) {
          const key = `${chain}:${l.transactionHash}:${l.logIndex}`;
          if (seen.current.has(key) || !l.eventName) continue;
          seen.current.add(key);
          out.push({
            key,
            chain,
            block: Number(l.blockNumber),
            tx: l.transactionHash,
            logIndex: Number(l.logIndex),
            name: l.eventName,
            args: l.args ?? {},
            address: l.address,
            fresh: booted.current[chain],
          });
        }
      }
      cursors.current[chain] = head + 1n;
      booted.current[chain] = true;
      // Block timestamps for the timeline (cached, one request per new block).
      await Promise.all(
        [...new Set(out.map((e) => e.block))].map(async (b) => {
          const k = `${chain}:${b}`;
          if (tsCache.current.has(k)) return;
          try {
            const blk = await cl.getBlock({ blockNumber: BigInt(b) });
            tsCache.current.set(k, Number(blk.timestamp));
          } catch {}
        }),
      );
      for (const e of out) e.ts = tsCache.current.get(`${chain}:${e.block}`);
      return out;
    }

    let running = false;
    let reading = false;
    async function tick() {
      // State is shown as soon as it arrives; logs (history on the first pass) follow behind.
      // Neither loop overlaps itself, so a slow RPC can't pile requests up.
      if (!reading) {
        reading = true;
        readState(cfg!)
          .then((s) => {
            if (!stop) {
              setState(s);
              setLastSync(Date.now());
              setError(null);
            }
          })
          .catch((e) => setError(String(e?.shortMessage || e?.message || e).slice(0, 160)))
          .finally(() => (reading = false));
      }
      if (running) return;
      running = true;
      try {
        const logs = await Promise.all([pullLogs("lasna"), pullLogs("base"), pullLogs("unichain")]);
        if (stop) return;
        const fresh = logs.flat();
        if (fresh.length) {
          setEvents((prev) =>
            [...prev, ...fresh].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || a.block - b.block || a.logIndex - b.logIndex).slice(-400),
          );
        }
        setError(null);
      } catch (e: any) {
        setError(String(e?.shortMessage || e?.message || e).slice(0, 160));
      } finally {
        running = false;
      }
    }

    tick();
    const id = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [cfg]);

  return { cfg, state, events, heads, error, lastSync };
}

// ------------------------------------------------------------------ operator actions

export type ActionName = "honest" | "attack" | "drain" | "copycat" | "resolve";
export interface ActionLine {
  t: number;
  kind: "start" | "tx" | "note" | "alarm" | "done" | "error";
  text?: string;
  label?: string;
  chain?: ChainKey;
  hash?: Hex;
  status?: string;
  action?: string;
}

export async function runAction(name: ActionName, body: object, onLine: (l: ActionLine) => void) {
  const r = await fetch(`/api/action/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-noether": "1" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    onLine({ t: Date.now(), kind: "error", text: e.error || "action failed" });
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}
