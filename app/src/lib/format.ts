import type { ChainKey, Config } from "./noether";

export function tok(v?: bigint, digits = 2) {
  if (v === undefined) return "—";
  const n = Number(v) / 1e18;
  if (n >= 1e6) return (n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 3 }) + "M";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function eth(v?: bigint, digits = 4) {
  if (v === undefined) return "—";
  return (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function short(h?: string, a = 6, b = 4) {
  if (!h) return "";
  return h.length <= a + b + 1 ? h : `${h.slice(0, a)}…${h.slice(-b)}`;
}

export function txUrl(cfg: Config | null, chain: ChainKey, hash: string) {
  return cfg ? cfg.chains[chain].tx + hash : "#";
}

export function addrUrl(cfg: Config | null, chain: ChainKey, a: string) {
  return cfg ? cfg.chains[chain].address + a : "#";
}

export function ago(ts?: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const CHAIN_LABEL: Record<ChainKey, string> = { base: "Base Sepolia", unichain: "Unichain Sepolia", lasna: "Reactive Lasna" };
