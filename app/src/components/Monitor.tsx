import type { Config, LiveState, NEvent } from "../lib/noether";
import { ago, short, tok } from "../lib/format";
import { Reveal, SectionHead } from "./ui";

const CHAIN: Record<number, { name: string; addr: string }> = {
  84532: { name: "Base Sepolia", addr: "https://sepolia.basescan.org/address/" },
  1301: { name: "Unichain Sepolia", addr: "https://sepolia.uniscan.xyz/address/" },
  11155111: { name: "Ethereum Sepolia", addr: "https://sepolia.etherscan.io/address/" },
};
const fmt = (v: bigint) => {
  const n = Number(v) / 1e18;
  return n !== 0 && n < 0.01 ? n.toFixed(4) : tok(v, 4);
};

export function MonitorSection({ cfg, state, events }: { cfg: Config | null; state: LiveState | null; events: NEvent[] }) {
  const routes = state?.routes ?? [];
  const mon = cfg?.contracts.monitor;
  const feed = events
    .filter((e) => ["TransferMatched", "UnexplainedDelivery", "DeliveryExplained", "UnbackedDelivery", "TransferSent", "RouteWatched"].includes(e.name))
    .slice(-8)
    .reverse();
  return (
    <section className="sec" id="monitor">
      <div className="container">
        <SectionHead
          pill="Monitor mode"
          title={<>Audit any Hyperlane route,<br />with zero integration</>}
          sub="Hyperlane routes are permissionless, so anyone can deploy one, and every router emits the same public events. Noether audits a route from those events alone: the route's owner installs nothing."
        />
        <Reveal>
          <div className="card" style={{ padding: 0 }}>
            <div className="mon-head">
              <span>Route</span>
              <span>Escrowed (side A)</span>
              <span>Circulating (side B)</span>
              <span>Books</span>
              <span>Matched</span>
              <span>Unbacked</span>
            </div>
            {!mon && <div className="empty" style={{ margin: 18 }}>Monitor not deployed on this network yet.</div>}
            {mon && routes.length === 0 && <div className="empty" style={{ margin: 18 }}>Loading watched routes from Lasna…</div>}
            {routes.map((r) => {
              const balanced = r.circulating <= r.escrowed;
              const third = r.name.toLowerCase().includes("registry");
              return (
                <div className="mon-row" key={r.id}>
                  <div>
                    <div className="mon-name">
                      {r.name}
                      <span className={`mon-tag ${third ? "ext" : ""}`}>{third ? "third-party" : "ours"}</span>
                    </div>
                    <div className="mon-sub">
                      <a href={(CHAIN[r.chainA]?.addr ?? "#") + r.routerA} target="_blank" rel="noreferrer">{CHAIN[r.chainA]?.name ?? r.chainA} {short(r.routerA)}</a>
                      {"  ⇄  "}
                      <a href={(CHAIN[r.chainB]?.addr ?? "#") + r.routerB} target="_blank" rel="noreferrer">{CHAIN[r.chainB]?.name ?? r.chainB} {short(r.routerB)}</a>
                    </div>
                  </div>
                  <div className="mono">{fmt(r.escrowed)}</div>
                  <div className="mono" style={{ color: balanced ? undefined : "#ff8a96" }}>{fmt(r.circulating)}</div>
                  <div>
                    <span className={`tag ${balanced ? "ok" : "bad"}`}>{balanced ? "balanced" : "unbacked supply"}</span>
                  </div>
                  <div className="mono">{r.matched}</div>
                  <div className="mono" style={{ color: r.unbacked ? "#ff8a96" : undefined }}>{r.unbacked}</div>
                </div>
              );
            })}
          </div>
        </Reveal>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <Reveal>
            <div className="card">
              <h3>Monitor vs Enforce</h3>
              <table className="table" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th></th><th>Monitor</th><th>Enforce</th></tr>
                </thead>
                <tbody>
                  <tr><td>Integration</td><td>None</td><td>Install NoetherIsm on the route</td></tr>
                  <tr><td>Setup</td><td>One watchRoute transaction</td><td>Deploy guard + ledger</td></tr>
                  <tr><td>Detects unbacked mints / releases</td><td>Yes</td><td>Yes</td></tr>
                  <tr><td>On violation</td><td>On-chain alert anyone can act on</td><td>Freeze every chain, trace, pay cover</td></tr>
                  <tr><td>Trust in the route</td><td>None</td><td>None</td></tr>
                </tbody>
              </table>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="card">
              <h3>Audit trail</h3>
              <p className="d">Every match and alert is a Lasna transaction from the monitor{mon ? <> (<a className="mono" style={{ color: "var(--blue-soft)" }} href={`https://lasna.reactscan.net/address/${mon}`} target="_blank" rel="noreferrer">{short(mon)}</a>)</> : null}.</p>
              <div style={{ marginTop: 12, display: "grid", gap: 6, position: "relative" }}>
                {feed.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No route activity in the recent window. Most testnet routes are quiet; transfers appear here within seconds.</div>}
                {feed.map((e) => (
                  <a key={e.key} href={`https://lasna.reactscan.net/tx/${e.tx}`} target="_blank" rel="noreferrer" className="mon-ev">
                    <span className={e.name === "UnbackedDelivery" ? "breach" : e.name === "UnexplainedDelivery" ? "warn" : e.name === "TransferMatched" || e.name === "DeliveryExplained" ? "ok" : "mute"}>
                      {e.name === "TransferMatched" && `✓ Delivery matched: ${fmt(e.args.amount)} on ${CHAIN[Number(e.args.onChain)]?.name}`}
                      {e.name === "TransferSent" && `↗ Send seen: ${fmt(e.args.amount)} from ${CHAIN[Number(e.args.fromChain)]?.name}`}
                      {e.name === "UnexplainedDelivery" && `… Delivery with no send yet: ${fmt(e.args.amount)}`}
                      {e.name === "DeliveryExplained" && `✓ Send arrived, delivery explained`}
                      {e.name === "UnbackedDelivery" && `✗ UNBACKED delivery: ${fmt(e.args.amount)} on ${CHAIN[Number(e.args.onChain)]?.name}`}
                      {e.name === "RouteWatched" && `◎ Now watching: ${e.args.name}`}
                    </span>
                    <span className="faint mono" style={{ fontSize: 11 }}>{ago(e.ts)} ↗</span>
                  </a>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
