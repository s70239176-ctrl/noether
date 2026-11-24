import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveState, NEvent } from "../lib/noether";
import { tok } from "../lib/format";
import { Ring, Sparkle, Spark } from "./ui";

const MODES = ["NORMAL", "ALERT", "BREACHED"];
const toN = (v: any) => Number(v ?? 0) / 1e18;

/** The hero's product shot is the real, live Noether dashboard. */
export function Dashboard({
  state,
  events,
  heads,
  lastSync,
}: {
  state: LiveState | null;
  events: NEvent[];
  heads: Partial<Record<string, number>>;
  lastSync: number;
}) {
  const mode = state?.mode ?? 0;
  // Live readings taken by this page, so the charts draw a real line even when the ledger is quiet.
  const snaps = useRef<{ t: number; esc: number; circ: number }[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!state) return;
    snaps.current = [...snaps.current, { t: Date.now() / 1000, esc: toN(state.escrowed), circ: toN(state.circulating) }].slice(-240);
    bump((n) => n + 1);
  }, [state]);
  const series = useMemo(() => {
    const pts = events
      .filter((e) => e.name === "Accounted" && e.ts)
      .map((e) => ({ t: e.ts!, esc: toN(e.args.escrowed), circ: toN(e.args.circulating) }));
    return [...pts, ...snaps.current].sort((a, b) => a.t - b.t);
  }, [events, state]);

  const esc = toN(state?.escrowed);
  const circ = toN(state?.circulating);
  const health = !state ? 0 : circ === 0 ? 100 : Math.min(100, (esc / circ) * 100);
  const healthColor = health >= 99.99 ? "#2086ff" : health > 50 ? "#ffb547" : "#ff4d5e";
  const suspect = [...events].reverse().find((e) => e.name === "SuspectRaised");
  const broken = [...events].reverse().find((e) => e.name === "ConservationBroken");
  const landed = events.filter((e) => e.name === "GuardFrozen").length;
  const synced = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : null;

  return (
    <div className="browser">
      <div className="browser-in">
        <div className="chrome">
          <div className="lights">
            <i style={{ background: "#ff5f57" }} />
            <i style={{ background: "#febc2e" }} />
            <i style={{ background: "#28c840" }} />
          </div>
          <div className="url">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            noether · live
          </div>
        </div>
        <div className="app-shell">
          <aside className="side">
            <div className="logo">
              <Sparkle /> Noether
            </div>
            <a className="on" href="#top">◧ Dashboard</a>
            <a href="#map">◎ Live map</a>
            <a href="#console">▶ Console</a>
            <a href="#scorer">✧ Neural scorer</a>
            <a href="#cover">◈ Cover pool</a>
            <a href="#events">≋ Event stream</a>
            <div className="grp">Chains</div>
            <a href="#events">Base <span className="badge">#{heads.base ? String(heads.base).slice(-5) : "…"}</span></a>
            <a href="#events">Unichain <span className="badge">#{heads.unichain ? String(heads.unichain).slice(-5) : "…"}</span></a>
            <a href="#events">Lasna <span className="badge">#{heads.lasna ? String(heads.lasna).slice(-5) : "…"}</span></a>
          </aside>
          <div className="dash">
            <div className="dash-h">
              Conservation status
              <span className={`mode-chip m${mode}`}>
                <span className="status-dot" />
                {state ? MODES[mode] : "SYNCING"}
              </span>
            </div>
            <div className="dash-s">
              One ledger on Reactive Lasna, reading both ends of a live Hyperlane route{synced !== null ? ` · synced ${synced}s ago` : ""}
            </div>

            <div className="dash-grid">
              <div className="tile">
                <div className="k">Escrowed on Base</div>
                <div className="v">{tok(state?.escrowed)}</div>
                <div className="d">
                  <span className="up">●</span> Σ locked − Σ released · dUSD
                </div>
                <Spark values={series.map((p) => p.esc)} color="#2086ff" />
              </div>
              <div className="tile">
                <div className="k">Circulating on Unichain</div>
                <div className="v" style={{ color: circ > esc + 1e-9 ? "#ff8a96" : undefined }}>{tok(state?.circulating)}</div>
                <div className="d">
                  <span className={circ > esc + 1e-9 ? "down" : "up"}>●</span> Σ minted − Σ burned · ndUSD
                </div>
                <Spark values={series.map((p) => p.circ)} color={circ > esc + 1e-9 ? "#ff4d5e" : "#8ab8ff"} />
              </div>
              <div className="tile">
                <div className="k">Law health ⓘ</div>
                <div className="ring-wrap" style={{ position: "relative" }}>
                  <Ring value={health} color={healthColor} />
                  <div className="num" style={{ top: 34 }}>{state ? (health >= 99.99 ? "100" : health < 1 ? health.toFixed(2) : health.toFixed(0)) : "…"}</div>
                  <div className="cap" style={{ top: 34 }}>escrowed ÷ circulating</div>
                </div>
              </div>
            </div>

            <div className="dash-grid2">
              <div className="tile">
                <div className="chart-head">
                  <div>
                    <div className="k" style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Supply vs escrow</div>
                    <div className="dash-s" style={{ margin: "2px 0 0" }}>Ledger history plus this page's live readings</div>
                  </div>
                  <span className="seg">log scale</span>
                </div>
                <SupplyChart series={series} />
                <div className="legend">
                  <span><i style={{ background: "#2086ff" }} />escrowed (Base)</span>
                  <span><i style={{ background: "#8ab8ff" }} />circulating (Unichain)</span>
                </div>
              </div>
              <div className="tile" style={{ background: "linear-gradient(180deg, #0f1a33, #0b1020)" }}>
                <div className="k" style={{ fontWeight: 600, color: "#fff" }}>✦ Neural scorer</div>
                <div className="dash-s" style={{ margin: "2px 0 4px" }}>Runs inside react() on every unexplained delivery</div>
                {suspect ? (
                  <div className="insight">
                    <b>{Number(suspect.args.probabilityBps) >= 9500 ? "Forgery detected" : "Suspect raised"}</b>
                    {tok(suspect.args.amount)} delivered with no dispatch behind it · p ≈ {(Number(suspect.args.probabilityBps) / 100).toFixed(2)}%
                    <div className="row">
                      <span>logit {(Number(suspect.args.logit) / 1e6).toFixed(2)}</span>
                      <span className="chip">{Number(suspect.args.probabilityBps) >= 9500 ? "Freeze now" : "Grace window"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="insight">
                    <b>All deliveries explained</b>
                    No unexplained delivery in the last hour.
                    <div className="row"><span>threshold p ≥ 0.95</span><span className="chip">Watching</span></div>
                  </div>
                )}
                <div className="insight">
                  <b>{mode === 2 ? "Route frozen on every chain" : mode === 1 ? "Grace window open" : "Route open"}</b>
                  {mode === 2
                    ? `${broken ? "Conservation broken. " : ""}${landed ? `${landed} freeze callback${landed > 1 ? "s" : ""} landed. ` : ""}Only governance unfreezes.`
                    : mode === 1
                      ? "Redemptions and cover sales held while Cron1 ticks."
                      : "Every delivery is matched to its dispatch by message id."}
                  <div className="row">
                    <span>Cron1 {state?.clockOn ? "subscribed" : "off"}</span>
                    <span className="chip" style={{ background: mode === 2 ? "#ff4d5e" : undefined }}>{MODES[mode]}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplyChart({ series }: { series: { t: number; esc: number; circ: number }[] }) {
  const W = 600, H = 170, P = 30;
  if (series.length < 2) {
    return <div className="dash-s" style={{ height: H, display: "grid", placeItems: "center" }}>Collecting ledger history…</div>;
  }
  const t0 = series[0].t, t1 = series[series.length - 1].t || t0 + 1;
  const lg = (v: number) => Math.log10(Math.max(1, v));
  const maxL = Math.max(3, ...series.map((p) => lg(Math.max(p.esc, p.circ)))) + 0.3;
  const X = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - P - 6);
  const Y = (v: number) => H - 14 - (lg(v) / maxL) * (H - 28);
  const path = (k: "esc" | "circ") => series.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  const ticks = [0, 3, 6, 9].filter((l) => l <= maxL);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", marginTop: 8 }} aria-hidden="true">
      <defs>
        <linearGradient id="circFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8ab8ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8ab8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((l) => (
        <g key={l}>
          <line x1={P} x2={W - 6} y1={Y(10 ** l)} y2={Y(10 ** l)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 5" />
          <text x={P - 6} y={Y(10 ** l) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="IBM Plex Mono">
            {l === 0 ? "1" : l === 3 ? "1K" : l === 6 ? "1M" : "1B"}
          </text>
        </g>
      ))}
      <path d={`${path("circ")} L${X(t1)},${H - 14} L${X(t0)},${H - 14} Z`} fill="url(#circFill)" />
      <path d={path("circ")} fill="none" stroke="#8ab8ff" strokeWidth="2" />
      <path d={path("esc")} fill="none" stroke="#2086ff" strokeWidth="2" />
      <circle cx={X(t1)} cy={Y(series[series.length - 1].circ)} r="4" fill="#fff" stroke="#8ab8ff" strokeWidth="2" />
    </svg>
  );
}
