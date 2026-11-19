import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ActionLine, ActionName, ChainKey, Config, LiveState, NEvent } from "../lib/noether";
import { runAction } from "../lib/noether";
import { ago, eth, short, tok, txUrl, addrUrl, CHAIN_LABEL } from "../lib/format";
import { forward, FEATURE_NAMES, W1n, W2n } from "../lib/brain";
// @ts-ignore shared JS module
import { REASONS } from "../../shared/abi.js";

const chainOf = (id: any): ChainKey => (Number(id) === 84532 ? "base" : Number(id) === 1301 ? "unichain" : "lasna");
const hex32 = (v: any) => ("0x" + BigInt(v).toString(16).padStart(64, "0")) as `0x${string}`;
const msgAmount = (m: string) => (m && m.length >= 2 + 141 * 2 ? BigInt("0x" + m.slice(2 + 109 * 2, 2 + 141 * 2)) : 0n);

// ------------------------------------------------------------------ The Law

export function LawPanel({ state }: { state: LiveState | null }) {
  const gap = state && state.circulating > state.escrowed ? state.circulating - state.escrowed : 0n;
  const bad = !!state && state.mode === 2;
  // After governance resolves an incident, the forged supply still exists on-chain: show it, but as history.
  const legacy = !!state && state.mode !== 2 && gap > 0n;
  return (
    <div className="panel law">
      <div className="eyebrow"><span className="n">01</span> The law</div>
      <h1>
        Value is <em>conserved</em> across chains, or the route freezes.
      </h1>
      <p className="lede">
        Every token delivered on one chain must have been dispatched, exactly once, on the other. No single chain can check that.
        Noether reads both halves of a live Hyperlane route from Reactive Lasna and enforces it in about a second.
      </p>
      <div className="equation">
        <div className="eq-row">
          <div className="eq-side">
            <div className="lbl">circulating on Unichain</div>
            <div className="val c-uni">{tok(state?.circulating)}</div>
            <div className="sub">Σ minted − Σ burned</div>
          </div>
          <div className={`eq-op ${bad || legacy ? "bad" : ""}`} style={legacy && !bad ? { animation: "none", opacity: 0.7 } : undefined}>{bad || legacy ? "≰" : "≤"}</div>
          <div className="eq-side">
            <div className="lbl">escrowed on Base</div>
            <div className="val c-base">{tok(state?.escrowed)}</div>
            <div className="sub">Σ locked − Σ released</div>
          </div>
        </div>
        <div className="eq-verdict">
          {!state ? (
            <span className="tag">connecting to three chains…</span>
          ) : bad ? (
            <>
              <span className="tag bad">LAW BROKEN</span>
              {gap > 0n && <span className="tag bad">{tok(gap)} unbacked</span>}
              <span className="mute">route frozen until governance resolves</span>
            </>
          ) : state.mode === 1 ? (
            <span className="tag warn">suspect inside the grace window</span>
          ) : legacy ? (
            <>
              <span className="tag ok">watching · new deliveries matched by message id</span>
              <span className="tag warn">{tok(gap)} unbacked from resolved incidents</span>
            </>
          ) : (
            <span className="tag ok">law holds · every delivery matched by message id</span>
          )}
        </div>
      </div>
      <div className="statline">
        <div className="stat"><div className="k">locked</div><div className="v">{tok(state?.locked)}</div></div>
        <div className="stat"><div className="k">released</div><div className="v">{tok(state?.released)}</div></div>
        <div className="stat"><div className="k">minted</div><div className="v">{tok(state?.minted)}</div></div>
        <div className="stat"><div className="k">burned</div><div className="v">{tok(state?.burned)}</div></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Ladder

export function Ladder({ state, events }: { state: LiveState | null; events: NEvent[] }) {
  const lastBreak = [...events].reverse().find((e) => e.name === "ConservationBroken");
  const neural = state?.mode === 2 && lastBreak && Number(lastBreak.args.reason) === 7;
  const on = (i: number) =>
    i === 0 ? state?.mode === 0 : i === 1 ? state?.mode === 1 : i === 2 ? !!neural : state?.mode === 2;
  const rungs = [
    ["Normal", "Every Inbound matched to its Dispatch by Hyperlane message id. Zero callbacks, no clock."],
    ["Suspect", "Delivery with no dispatch yet: quarantine, hold redemptions and cover sales, subscribe Cron1."],
    ["Neural", "6-8-1 network inside react() rates the suspect; at p ≥ 0.95 it skips the grace window."],
    ["Violation", "Freeze every chain, quarantine and trace the attacker, pay cover. Only governance unfreezes."],
  ];
  return (
    <div className="panel">
      <div className="eyebrow"><span className="n">03</span> Response ladder · live</div>
      <div className="ladder">
        {rungs.map(([n, d], i) => (
          <div key={n} className={`rung s${i} ${on(i) ? "on" : ""}`}>
            <div className="num">0{i + 1}</div>
            <div className="name">{n}</div>
            <div className="desc">{d}</div>
          </div>
        ))}
      </div>
      <div className="clockline">
        <span className={`tag ${state?.clockOn ? "warn" : ""}`}>
          <span className="dot" style={{ color: state?.clockOn ? "var(--warn)" : "var(--faint)" }} />
          Cron1 {state?.clockOn ? "subscribed: grace clock ticking" : "unsubscribed (only while suspicious)"}
        </span>
        <span className="tag">grace {state?.grace ?? "–"} Lasna blocks</span>
        <span className="tag">open suspects {state?.openSuspects ?? "–"}</span>
        <span className={`tag ${state?.tainted ? "bad" : ""}`}>taint subscriptions {state?.tainted ?? "–"}</span>
        <span className="tag">incidents {state?.incidents ?? "–"}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Operator console

const ACTIONS: { name: ActionName; k: string; t: string; d: string; arm?: boolean; wide?: boolean }[] = [
  { name: "honest", k: "honest", t: "Bridge 1,000 dUSD", d: "transferRemote on Base, relayed through Hyperlane to Unichain. Noether should stay silent." },
  { name: "attack", k: "compromised key", t: "Forge a 1,000,000 mint", d: "Hand-built message 'from' the Base router, accepted by the real Unichain Mailbox.", arm: true },
  { name: "drain", k: "compromised key", t: "Drain the collateral", d: "Forged 'burn' message releases real dUSD on Base with nothing burned.", arm: true },
  { name: "copycat", k: "copycat", t: "Try again", d: "A second forged message. Rejected once Noether has frozen the route." },
  { name: "resolve", k: "governance", t: "Resolve the incident", d: "Human step after investigation: reset the ledger, unfreeze every guard, clear quarantine.", wide: true },
];

export function Console({ cfg, state }: { cfg: Config | null; state: LiveState | null }) {
  const [lines, setLines] = useState<ActionLine[]>([]);
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [armed, setArmed] = useState<ActionName | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const t0 = useRef(0);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  async function go(a: (typeof ACTIONS)[number]) {
    if (a.arm && armed !== a.name) {
      setArmed(a.name);
      setTimeout(() => setArmed((x) => (x === a.name ? null : x)), 4000);
      return;
    }
    setArmed(null);
    setBusy(a.name);
    t0.current = Date.now();
    setLines((l) => [...l, { t: Date.now(), kind: "start", text: `▶ ${a.t}` }]);
    await runAction(a.name, {}, (ln) => {
      if (ln.kind !== "start") setLines((l) => [...l, ln]);
    });
    setBusy(null);
  }

  const op = !!cfg?.operator;
  return (
    <div className="panel">
      <div className="eyebrow"><span className="n">04</span> Operator console · live testnet</div>
      <h2 className="title">Run it <em>for real</em>.</h2>
      {!op && (
        <div className="watchonly">
          Watch-only mode: this server has no operator key. Run the app locally with the project's .env to execute live scenarios.
        </div>
      )}
      <div className="actions">
        {ACTIONS.map((a) => (
          <button
            key={a.name}
            className={`act ${a.name} ${armed === a.name ? "armed" : ""} ${a.wide ? "wide" : ""}`}
            disabled={!op || !!busy || (a.name === "resolve" && state?.mode !== 2 && !state?.homeFrozen && !state?.spokeFrozen && !state?.homeHeld)}
            onClick={() => go(a)}
          >
            <div className="k">{busy === a.name ? "running…" : armed === a.name ? "click again to fire" : a.k}</div>
            <div className="t">{a.t}</div>
            <div className="d">{a.d}</div>
          </button>
        ))}
      </div>
      <div className="log" ref={logRef}>
        {lines.length === 0 && <div className="faint">Actions stream here step by step, with explorer links for every transaction.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`ln ${l.kind}`}>
            <span className="tm">{l.kind === "start" && l.text ? "" : `+${((l.t - t0.current) / 1000).toFixed(1)}s`}</span>
            <span>
              {l.kind === "tx" ? (
                <>
                  {l.status === "confirmed" ? "✓" : "↗"} {l.label} on {CHAIN_LABEL[l.chain!]}{" "}
                  <a href={txUrl(cfg, l.chain!, l.hash!)} target="_blank" rel="noreferrer">{short(l.hash, 8, 6)}</a>
                </>
              ) : (
                l.text
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Incident dossier

export function Incident({ cfg, events }: { cfg: Config | null; events: NEvent[] }) {
  const inc = useMemo(() => {
    const brk = [...events].reverse().find((e) => e.name === "ConservationBroken");
    if (!brk) return null;
    const id = brk.args.incidentId as string;
    const rel = events.filter((e) => e.args?.incidentId === id);
    const frozen = rel.filter((e) => e.name === "GuardFrozen");
    const originTs = frozen.length ? Number(frozen[0].args.originTimestamp) : brk.ts;
    const originChain = chainOf(brk.args.chainId);
    const rows: { label: string; chain: ChainKey; ts?: number; tx: string; color: string }[] = [
      { label: `Forged delivery accepted by Hyperlane Mailbox`, chain: originChain, ts: originTs, tx: hex32(brk.args.originTxHash), color: "var(--breach)" },
      { label: `Noether reacts: ${REASONS[Number(brk.args.reason)]}`, chain: "lasna", ts: brk.ts, tx: brk.tx, color: "var(--lasna)" },
    ];
    for (const e of rel) {
      if (e.name === "GuardFrozen")
        rows.push({ label: e.address.toLowerCase() === cfg?.contracts.cover.toLowerCase() ? "Cover sales closed, payout opened" : `${CHAIN_LABEL[e.chain]} route frozen`, chain: e.chain, ts: Number(e.args.landedAt), tx: e.tx, color: "var(--cyan)" });
      if (e.name === "AccountQuarantine")
        rows.push({ label: `Quarantined ${short(e.args.account)}`, chain: e.chain, ts: Number(e.args.landedAt), tx: e.tx, color: "var(--warn)" });
      if (e.name === "PayoutCompleted")
        rows.push({ label: `Cover paid out: ${eth(e.args.totalPaid)} ETH, no claims`, chain: e.chain, ts: e.ts, tx: e.tx, color: "var(--ok)" });
    }
    const freezeLat = frozen.length ? Math.max(...frozen.map((f) => Number(f.args.landedAt) - Number(f.args.originTimestamp))) : null;
    const landed = rel.filter((e) => e.name === "GuardFrozen" || e.name === "AccountQuarantine").length;
    return { brk, rows, originTs, freezeLat, landed, callbacks: events.filter((e) => e.name === "CallbackSent" && e.tx === brk.tx).length };
  }, [events, cfg]);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const waiting = inc && inc.landed < inc.callbacks && inc.brk.ts ? Math.round(Date.now() / 1000 - inc.brk.ts) : 0;

  return (
    <div className="panel dossier">
      <div className="eyebrow"><span className="n">05</span> Incident dossier</div>
      {!inc ? (
        <div className="empty">
          No conservation-law violation in the recent window. Forge a mint from the console and the full loop appears here: origin
          transaction, Lasna reaction, each freeze landing, and cover payout, with seconds measured from on-chain timestamps.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <div className="mute" style={{ fontSize: 12 }}>Noether decided in</div>
              <div className="big" style={{ color: "var(--lasna)" }}>
                {inc.brk.ts !== undefined && inc.originTs !== undefined ? Math.max(0, inc.brk.ts - inc.originTs) : "…"}<small>s</small>
              </div>
            </div>
            <div>
              <div className="mute" style={{ fontSize: 12 }}>every chain frozen after</div>
              <div className="big breach">
                {inc.freezeLat !== null ? `${Math.max(inc.freezeLat, 0)}` : "…"}<small>s</small>
              </div>
              <div className="faint" style={{ fontSize: 11 }}>includes Reactive callback delivery</div>
            </div>
            <div style={{ fontSize: 13 }}>
              <div><span className="tag bad">{REASONS[Number(inc.brk.args.reason)]}</span></div>
              <div className="mute" style={{ marginTop: 6 }}>
                {tok(inc.brk.args.amount)} delivered to <span className="mono">{short(inc.brk.args.account)}</span> on {CHAIN_LABEL[chainOf(inc.brk.args.chainId)]}
              </div>
              <div className="mute">{inc.callbacks} callbacks from one reactive transaction · {ago(inc.brk.ts)}</div>
            </div>
          </div>
          {inc.callbacks > 0 && (
            <div className="clockline">
              <span className={`tag ${inc.landed >= inc.callbacks ? "ok" : "warn"}`}>
                callbacks landed {Math.min(inc.landed, inc.callbacks)} / {inc.callbacks}
              </span>
              {waiting > 0 && (
                <span className="tag warn">
                  awaiting Reactive callback delivery · {waiting >= 60 ? `${Math.floor(waiting / 60)}m ${waiting % 60}s` : `${waiting}s`}
                </span>
              )}
            </div>
          )}
          <ul className="timeline">
            {inc.rows
              .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
              .map((r, i) => {
                const d = r.ts !== undefined && inc.originTs !== undefined ? r.ts - inc.originTs : null;
                return (
                  <li key={i}>
                    <span className="plus">{d === null ? "" : d <= 0 ? (i === 0 ? "t = 0" : "+0s") : `+${d}s`}</span>
                    <span className="pin" style={{ color: r.color }} />
                    <span>{r.label} <span className="faint">· {CHAIN_LABEL[r.chain]}</span></span>
                    <a href={txUrl(cfg, r.chain, r.tx)} target="_blank" rel="noreferrer">{short(r.tx, 6, 4)} ↗</a>
                  </li>
                );
              })}
          </ul>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Seconds compare block timestamps across chains (each keeps its own ~1 s clock), so Lasna can read "+0s".
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Neural scorer

const PRESETS: Record<string, number[]> = {
  "Honest race": [0.1, 0.02, 0, 0.25, 0, 0.01],
  "Quiet forgery": [0.02, 0.05, 0, 0.25, 0, 0.01],
  "Whale forgery": [1, 1, 1, 0.25, 0, 0.02],
};

export function Brain({ events }: { events: NEvent[] }) {
  const [x, setX] = useState<number[]>(PRESETS["Whale forgery"]);
  const out = forward(x);
  const last = [...events].reverse().find((e) => e.name === "SuspectRaised");
  const pos = (layer: number, i: number, n: number) => ({ x: [44, 236, 420][layer], y: 26 + ((i + 0.5) * 228) / n });
  return (
    <div className="panel brain">
      <div className="eyebrow"><span className="n">06</span> Neural scorer · runs inside react()</div>
      <h2 className="title">Honest race, or <em>forgery?</em></h2>
      <svg viewBox="0 0 470 260">
        {W1n.map((row: number[], i: number) =>
          row.map((w: number, j: number) => {
            const a = pos(0, i, 6), b = pos(1, j, 8);
            return <line key={`a${i}${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={w > 0 ? "#5be4ff" : "#ff4fc3"} strokeOpacity={Math.min(0.85, Math.abs(w) / 5) * (0.25 + x[i])} strokeWidth={0.6 + Math.min(2.2, Math.abs(w) / 2)} />;
          }),
        )}
        {W2n.map((w: number, j: number) => {
          const a = pos(1, j, 8), b = pos(2, 0, 1);
          return <line key={`b${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={w > 0 ? "#5be4ff" : "#ff4fc3"} strokeOpacity={Math.min(0.9, 0.15 + out.hidden[j] / 3)} strokeWidth={0.8 + Math.min(2.5, Math.abs(w) / 2)} />;
        })}
        {x.map((v, i) => {
          const p = pos(0, i, 6);
          return <circle key={`i${i}`} cx={p.x} cy={p.y} r={9} fill={`rgba(160,139,255,${0.15 + v * 0.85})`} stroke="#a08bff" />;
        })}
        {out.hidden.map((h, j) => {
          const p = pos(1, j, 8);
          return <circle key={`h${j}`} cx={p.x} cy={p.y} r={8} fill={`rgba(91,228,255,${Math.min(1, 0.1 + h / 3)})`} stroke="#5be4ff" />;
        })}
        {(() => {
          const p = pos(2, 0, 1);
          const c = out.escalate ? "#ff4d5e" : out.p > 0.5 ? "#ffb547" : "#6cf2b0";
          return (
            <g>
              <circle cx={p.x} cy={p.y} r={24} fill={c} opacity="0.22" />
              <circle cx={p.x} cy={p.y} r={15} fill={c} />
              <text x={p.x} y={p.y + 44} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="#f4efe6">p = {out.p.toFixed(3)}</text>
            </g>
          );
        })()}
      </svg>
      <div className="gauge">
        <div className="fill" style={{ width: `${out.p * 100}%`, background: out.escalate ? "var(--breach)" : out.p > 0.5 ? "var(--warn)" : "var(--ok)" }} />
        <div className="thr" title="escalation threshold p ≥ 0.95" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 6 }}>
        <span className={out.escalate ? "breach" : "ok"}>{out.escalate ? "Freeze now: skip the grace window" : "Wait for the grace window"}</span>
        <span className="mono faint">logit {out.logit.toFixed(2)} · threshold 2.94</span>
      </div>
      <div className="sliders">
        {FEATURE_NAMES.map((n, i) => (
          <div className="slider" key={n}>
            <label>
              <span>{n}</span>
              <span className="mono">{x[i].toFixed(2)}</span>
            </label>
            <input type="range" min={0} max={1} step={0.01} value={x[i]} onChange={(e) => setX((v) => v.map((o, k) => (k === i ? Number(e.target.value) : o)))} />
          </div>
        ))}
      </div>
      <div className="presets">
        {Object.entries(PRESETS).map(([k, v]) => (
          <button key={k} className="chip" onClick={() => setX(v)}>{k}</button>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Same quantised weights and integer arithmetic as NoetherBrain.sol (bit-exact, see test_GoldenVectorsMatchPython).{" "}
        {last ? (
          <>Last live verdict on Lasna: logit {(Number(last.args.logit) / 1e6).toFixed(2)}, p ≈ {(Number(last.args.probabilityBps) / 100).toFixed(2)}%.</>
        ) : (
          <>No suspect raised in the recent window.</>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Cover + economy

export function CoverPanel({ state, events, cfg }: { state: LiveState | null; events: NEvent[]; cfg: Config | null }) {
  const [opBal, setOpBal] = useState<any>(null);
  useEffect(() => {
    if (!cfg?.operator) return;
    const f = () => fetch("/api/operator").then((r) => r.json()).then(setOpBal).catch(() => {});
    f();
    const id = setInterval(f, 15000);
    return () => clearInterval(id);
  }, [cfg]);
  const sales = state?.coverFrozen ? ["CLOSED", "breach"] : state?.coverHeld ? ["PAUSED", "warn"] : ["OPEN", "ok"];
  const recent = events.filter((e) => ["PolicyPaid", "PolicyExcluded", "CoverBought"].includes(e.name)).slice(-5).reverse();
  return (
    <div className="panel">
      <div className="eyebrow"><span className="n">07</span> Cover pool · economy</div>
      <div className="mute" style={{ fontSize: 12 }}>cover sales</div>
      <div className={`sales ${sales[1]}`}>{sales[0]}</div>
      <div className="kv">
        <span>Underwriting capital</span><span className="v">{eth(state?.capital)} ETH</span>
        <span>Outstanding cover</span><span className="v">{eth(state?.outstanding)} ETH</span>
        <span>Paid on last incident</span><span className="v">{eth(state?.totalPaid)} ETH</span>
        <span>Policies sold</span><span className="v">{state?.policies ?? "–"}</span>
        <span>Ledger REACT balance</span><span className="v">{eth(state?.ledgerReact, 3)} REACT</span>
        {opBal && (
          <>
            <span>Operator wallet</span><span className="v">{short(opBal.address)}</span>
            <span className="faint">· Base / Unichain / Lasna</span>
            <span className="v faint">{Number(opBal.base).toFixed(4)} / {Number(opBal.unichain).toFixed(4)} / {Number(opBal.lasna).toFixed(2)}</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        {recent.map((e) => (
          <div key={e.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
            <span className={e.name === "PolicyPaid" ? "ok" : e.name === "PolicyExcluded" ? "breach" : "mute"}>
              {e.name === "PolicyPaid" ? `Policy #${e.args.policyId} paid ${eth(e.args.payout)} ETH` : e.name === "PolicyExcluded" ? `Policy #${e.args.policyId} excluded: bought after the forgery` : `Policy #${e.args.policyId} bought`}
            </span>
            <a className="mono faint" style={{ fontSize: 11, textDecoration: "none" }} href={txUrl(cfg, e.chain, e.tx)} target="_blank" rel="noreferrer">{short(e.tx)} ↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Seismograph + feed

function describe(e: NEvent): [string, string] {
  const a = e.args;
  switch (e.name) {
    case "Dispatch":
      return [e.chain === "base" ? `Warp transfer dispatched → Unichain: ${tok(msgAmount(a.message))} dUSD` : `Bridge-out dispatched → Base: ${tok(msgAmount(a.message))}`, e.chain === "base" ? "c-base" : "c-uni"];
    case "Inbound":
      return [e.chain === "unichain" ? `Delivered on Unichain: ${tok(a.amount)} ndUSD minted` : `Delivered on Base: ${tok(a.amount)} dUSD released`, e.chain === "unichain" ? "c-uni" : "c-base"];
    case "Accounted":
      return [a.inbound ? "Ledger saw a delivery" : "Ledger saw a dispatch", "c-lasna"];
    case "SuspectRaised":
      return [`Suspect raised: ${tok(a.amount)} with no dispatch · p ≈ ${(Number(a.probabilityBps) / 100).toFixed(1)}%`, "warn"];
    case "SuspectCleared":
      return [`Suspect cleared after ${a.lasnaBlocksWaited} blocks`, "ok"];
    case "ConservationBroken":
      return [`CONSERVATION BROKEN · ${REASONS[Number(a.reason)]}`, "breach"];
    case "CallbackSent":
      return [`Callback → ${CHAIN_LABEL[chainOf(a.chainId)]} (${short(a.target)})`, "c-lasna"];
    case "ModeChanged":
      return [`Mode ${["NORMAL", "ALERT", "BREACHED"][Number(a.from)]} → ${["NORMAL", "ALERT", "BREACHED"][Number(a.to)]}`, Number(a.to) === 2 ? "breach" : "c-lasna"];
    case "ClockSwitched":
      return [a.on ? "Cron1 subscribed inside react()" : "Cron1 unsubscribed", "warn"];
    case "TaintTraced":
      return [`Taint traced ${short(a.from)} → ${short(a.to)}`, "breach"];
    case "GuardFrozen":
      return [`Route frozen · landed ${Number(a.landedAt) - Number(a.originTimestamp)}s after origin`, "breach"];
    case "GuardHeld":
      return ["Precautionary hold landed", "warn"];
    case "GuardLifted":
      return ["Hold lifted", "ok"];
    case "AccountQuarantine":
      return [`Quarantined ${short(a.account)}`, "breach"];
    case "GuardResolved":
      return ["Governance resolved the guard", "ok"];
    case "IncidentResolved":
      return ["Ledger incident resolved", "ok"];
    case "PayoutOpened":
      return [`Payout opened for ${a.policies} policies`, "ok"];
    case "PolicyPaid":
      return [`Policy #${a.policyId} paid ${eth(a.payout)} ETH`, "ok"];
    case "PolicyExcluded":
      return [`Policy #${a.policyId} excluded (bought after the forgery)`, "breach"];
    case "PayoutCompleted":
      return [`Payout completed: ${eth(a.totalPaid)} ETH`, "ok"];
    case "PayoutBatch":
      return [`Payout batch · ${a.remaining} remaining`, "mute"];
    case "PayoutContinued":
      return [`Noether requests next payout batch`, "c-lasna"];
    case "CoverBought":
      return [`Cover bought #${a.policyId}`, "mute"];
    default:
      return [e.name, "mute"];
  }
}

const LANES: ChainKey[] = ["base", "lasna", "unichain"];
const LANE_COLOR: Record<ChainKey, string> = { base: "#4a82ff", lasna: "#a08bff", unichain: "#ff4fc3" };

export function Seismograph({ cfg, events }: { cfg: Config | null; events: NEvent[] }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const timed = events.filter((e) => e.ts && e.name !== "Accounted");
  const span = 30 * 60;
  const x0 = now - span;
  const X = (t: number) => 90 + ((t - x0) / span) * 790;
  const feed = [...events].filter((e) => e.name !== "Accounted" && e.name !== "PayoutBatch").reverse().slice(0, 60);
  return (
    <div className="panel seis">
      <div className="eyebrow"><span className="n">08</span> Seismograph · last 30 minutes, three chains</div>
      <svg viewBox="0 0 900 190">
        {LANES.map((l, i) => (
          <g key={l}>
            <line x1="90" x2="880" y1={40 + i * 55} y2={40 + i * 55} stroke="rgba(255,255,255,0.08)" />
            <text x="0" y={44 + i * 55} fontFamily="JetBrains Mono" fontSize="11" fill={LANE_COLOR[l]}>{l === "lasna" ? "LASNA" : l === "base" ? "BASE" : "UNICHAIN"}</text>
          </g>
        ))}
        {[0, 10, 20, 30].map((m) => (
          <text key={m} x={X(now - m * 60)} y="186" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="10" fill="#5a5768">{m === 0 ? "now" : `−${m}m`}</text>
        ))}
        {timed.filter((e) => e.ts! >= x0).map((e) => {
          const y = 40 + LANES.indexOf(e.chain) * 55;
          const [, cls] = describe(e);
          const col = cls === "breach" ? "#ff4d5e" : cls === "warn" ? "#ffb547" : cls === "ok" ? "#6cf2b0" : LANE_COLOR[e.chain];
          const big = e.name === "ConservationBroken" || e.name === "GuardFrozen";
          return (
            <a key={e.key} href={txUrl(cfg, e.chain, e.tx)} target="_blank" rel="noreferrer">
              <title>{describe(e)[0]}</title>
              <line x1={X(e.ts!)} x2={X(e.ts!)} y1={y - (big ? 20 : 10)} y2={y + (big ? 20 : 10)} stroke={col} strokeWidth={big ? 3 : 1.6} />
              <circle cx={X(e.ts!)} cy={y} r={big ? 5 : 3} fill={col} />
            </a>
          );
        })}
      </svg>
      <div className="feed">
        {feed.length === 0 && <div className="faint" style={{ fontSize: 13 }}>Listening to Base Sepolia, Unichain Sepolia and Reactive Lasna…</div>}
        {feed.map((e) => {
          const [text, cls] = describe(e);
          return (
            <div key={e.key} className={`row ${e.fresh ? "fresh" : ""}`}>
              <span className="when">{ago(e.ts)}</span>
              <span className="ev" style={{ color: LANE_COLOR[e.chain] }}>{CHAIN_LABEL[e.chain]}</span>
              <span className={cls}>{text}</span>
              <a href={txUrl(cfg, e.chain, e.tx)} target="_blank" rel="noreferrer">{short(e.tx)} ↗</a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Footer

export function Footer({ cfg }: { cfg: Config | null }) {
  if (!cfg) return null;
  const c = cfg.contracts;
  const rows: [string, ChainKey, string][] = [
    ["NoetherLedger (reactive contract)", "lasna", c.ledger],
    ["Hyperlane Mailbox", "base", c.homeMailbox],
    ["HypERC20Collateral (warp route)", "base", c.homeRouter],
    ["NoetherIsm guard", "base", c.homeGuard],
    ["NoetherCover", "base", c.cover],
    ["Hyperlane Mailbox", "unichain", c.spokeMailbox],
    ["NoetherHypERC20 (warp route)", "unichain", c.spokeRouter],
    ["NoetherIsm guard", "unichain", c.spokeGuard],
  ];
  return (
    <div className="foot">
      <div className="panel">
        <div className="eyebrow"><span className="n">09</span> Live contracts</div>
        <div className="addr">
          {rows.map(([n, ch, a]) => (
            <Fragment key={n + ch}>
              <span>{n} <span className="faint">· {CHAIN_LABEL[ch]}</span></span>
              <a href={addrUrl(cfg, ch, a)} target="_blank" rel="noreferrer">{short(a, 8, 6)} ↗</a>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="eyebrow"><span className="n">10</span> Recorded on 2026-11-19</div>
        <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
          A forged 1,000,000 mint froze both chains in 1–2 s and paid cover in 3 s; a forged collateral drain froze Base in 1 s and
          its copycat was rejected.
        </div>
        <div className="addr" style={{ marginTop: 12 }}>
          <span>Forged mint · Unichain</span><a href="https://sepolia.uniscan.xyz/tx/0x4a58c335d50882d1b80f25d8ca582b093ffda76e1170359a8481fae431e8d5d4" target="_blank" rel="noreferrer">0x4a58c3…d5d4 ↗</a>
          <span>Noether reaction · Lasna</span><a href="https://lasna.reactscan.net/tx/0xeb4b319520edcad88bae85da1f5be342c626d55d10b535d2ea0e5bf8831ce2c9" target="_blank" rel="noreferrer">0xeb4b31…c2c9 ↗</a>
          <span>Base frozen · +1 s</span><a href="https://sepolia.basescan.org/tx/0x20e528ef0e88a08bd0dd0463b89401ab7f537fa8d34a3b15e5b5a477ca73432b" target="_blank" rel="noreferrer">0x20e528…432b ↗</a>
          <span>Cover paid · +3 s</span><a href="https://sepolia.basescan.org/tx/0xf15f0190a54492c248ea7522ad217407837f3d4071a80bab554fba6036dbeaad" target="_blank" rel="noreferrer">0xf15f01…eaad ↗</a>
        </div>
      </div>
    </div>
  );
}
