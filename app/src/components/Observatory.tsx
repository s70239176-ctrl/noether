import { useEffect, useRef } from "react";
import type { LiveState, NEvent } from "../lib/noether";
import { tok } from "../lib/format";

const P = {
  base: { x: 150, y: 335, r: 66 },
  uni: { x: 750, y: 335, r: 66 },
  lasna: { x: 450, y: 205, r: 54 },
};

// Motion paths (ids are referenced by the particle engine).
const PATHS: Record<string, string> = {
  bridge: "M 214 362 Q 450 545 686 362",
  bridgeRev: "M 686 362 Q 450 545 214 362",
  b2l: "M 196 288 Q 286 172 398 196",
  u2l: "M 704 288 Q 614 172 502 196",
  l2b: "M 410 244 Q 312 312 214 322",
  l2u: "M 490 244 Q 588 312 686 322",
};

const COLORS = { base: "#4a82ff", uni: "#ff4fc3", lasna: "#a08bff", cyan: "#5be4ff", breach: "#ff4d5e", ok: "#6cf2b0", warn: "#ffb547" };

function hexagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
}

export function Observatory({ state, events, attacker }: { state: LiveState | null; events: NEvent[]; attacker: string }) {
  const layer = useRef<SVGGElement>(null);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const done = useRef<Set<string>>(new Set());

  function fire(pathId: string, color: string, size = 4.5, dur = 1500, delay = 0) {
    const path = pathRefs.current[pathId];
    const g = layer.current;
    if (!path || !g) return;
    const NS = "http://www.w3.org/2000/svg";
    const glow = document.createElementNS(NS, "circle");
    const core = document.createElementNS(NS, "circle");
    glow.setAttribute("r", String(size * 3));
    glow.setAttribute("fill", color);
    glow.setAttribute("opacity", "0.22");
    core.setAttribute("r", String(size));
    core.setAttribute("fill", "#fff");
    core.setAttribute("stroke", color);
    core.setAttribute("stroke-width", "2");
    const len = path.getTotalLength();
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t + delay;
      const k = Math.min(1, Math.max(0, (t - start) / dur));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = path.getPointAtLength(e * len);
      for (const c of [glow, core]) {
        c.setAttribute("cx", String(pt.x));
        c.setAttribute("cy", String(pt.y));
      }
      if (k < 1) requestAnimationFrame(step);
      else {
        glow.remove();
        core.remove();
      }
    };
    g.append(glow, core);
    requestAnimationFrame(step);
  }

  function shock(x: number, y: number, color: string, from = 50, to = 150) {
    const g = layer.current;
    if (!g) return;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-width", "3");
    g.append(c);
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const k = Math.min(1, (t - start) / 1400);
      c.setAttribute("r", String(from + (to - from) * k));
      c.setAttribute("opacity", String(1 - k));
      if (k < 1) requestAnimationFrame(step);
      else c.remove();
    };
    requestAnimationFrame(step);
  }

  useEffect(() => {
    let lag = 0;
    for (const e of events) {
      if (done.current.has(e.key)) continue;
      done.current.add(e.key);
      if (!e.fresh) continue;
      const d = (lag += 120);
      if (e.name === "Dispatch") {
        if (e.chain === "base") {
          fire("bridge", COLORS.base, 5, 2400, d);
          fire("b2l", COLORS.base, 4, 1400, d);
        } else {
          fire("bridgeRev", COLORS.uni, 5, 2400, d);
          fire("u2l", COLORS.uni, 4, 1400, d);
        }
      } else if (e.name === "Inbound") {
        fire(e.chain === "unichain" ? "u2l" : "b2l", e.chain === "unichain" ? COLORS.uni : COLORS.base, 4, 1400, d);
      } else if (e.name === "CallbackSent") {
        const toBase = Number(e.args.chainId) === 84532;
        fire(toBase ? "l2b" : "l2u", COLORS.breach, 4.5, 1100, d);
      } else if (e.name === "ConservationBroken") {
        setTimeout(() => shock(P.lasna.x, P.lasna.y, COLORS.breach, 54, 210), d);
      } else if (e.name === "SuspectRaised") {
        setTimeout(() => shock(P.lasna.x, P.lasna.y, COLORS.warn, 54, 150), d);
      } else if (e.name === "GuardFrozen") {
        const pl = e.chain === "base" ? P.base : P.uni;
        setTimeout(() => shock(pl.x, pl.y, COLORS.breach, 66, 130), d);
      } else if (e.name === "SuspectCleared") {
        setTimeout(() => shock(P.lasna.x, P.lasna.y, COLORS.ok, 54, 140), d);
      }
    }
  }, [events]);

  const mode = state?.mode ?? 0;
  const breached = mode === 2;
  const coreColor = breached ? COLORS.breach : mode === 1 ? COLORS.warn : COLORS.lasna;

  return (
    <svg viewBox="0 0 900 560" role="img" aria-label="Live map of Base Sepolia, Reactive Lasna and Unichain Sepolia">
      <defs>
        <radialGradient id="gBase" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#bcd0ff" />
          <stop offset="35%" stopColor="#4a82ff" />
          <stop offset="100%" stopColor="#0b1a4a" />
        </radialGradient>
        <radialGradient id="gUni" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffd0f0" />
          <stop offset="35%" stopColor="#ff4fc3" />
          <stop offset="100%" stopColor="#4a0b37" />
        </radialGradient>
        <radialGradient id="gCore" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor={coreColor} />
          <stop offset="100%" stopColor="#120d2a" />
        </radialGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="900" height="560" fill="url(#grid)" />

      {/* stars */}
      {Array.from({ length: 60 }, (_, i) => (
        <circle key={i} cx={(i * 137.5) % 900} cy={(i * 89.3) % 560} r={i % 7 === 0 ? 1.4 : 0.7} fill="#fff" opacity={0.15 + ((i * 13) % 10) / 30} />
      ))}

      {/* Hyperlane route */}
      <path d={PATHS.bridge} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <path d={PATHS.bridge} fill="none" stroke="url(#gBase)" strokeWidth="1.5" className="flow" opacity="0.6" />
      <text x="450" y="498" textAnchor="middle" className="planet-label" fill="#8b8799">
        HYPERLANE WARP ROUTE · Mailbox v3
      </text>

      {/* observation feeds */}
      <path ref={(r) => { pathRefs.current.b2l = r; }} d={PATHS.b2l} fill="none" stroke={COLORS.base} strokeOpacity="0.35" strokeWidth="1.2" className="flow" />
      <path ref={(r) => { pathRefs.current.u2l = r; }} d={PATHS.u2l} fill="none" stroke={COLORS.uni} strokeOpacity="0.35" strokeWidth="1.2" className="flow" />
      {/* callbacks */}
      <path ref={(r) => { pathRefs.current.l2b = r; }} d={PATHS.l2b} fill="none" stroke={COLORS.lasna} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 6" />
      <path ref={(r) => { pathRefs.current.l2u = r; }} d={PATHS.l2u} fill="none" stroke={COLORS.lasna} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 6" />
      <path ref={(r) => { pathRefs.current.bridge = r; }} d={PATHS.bridge} fill="none" stroke="none" />
      <path ref={(r) => { pathRefs.current.bridgeRev = r; }} d={PATHS.bridgeRev} fill="none" stroke="none" />

      {/* Base */}
      <circle cx={P.base.x} cy={P.base.y} r={P.base.r + 18} fill={COLORS.base} opacity="0.18" filter="url(#soft)" />
      <circle cx={P.base.x} cy={P.base.y} r={P.base.r} fill="url(#gBase)" />
      {state?.homeHeld && !state.homeFrozen && (
        <circle cx={P.base.x} cy={P.base.y} r={P.base.r + 14} fill="none" stroke={COLORS.warn} strokeWidth="2" strokeDasharray="6 6" className="cage" />
      )}
      {state?.homeFrozen && (
        <polygon points={hexagon(P.base.x, P.base.y, P.base.r + 20)} fill="rgba(255,77,94,0.08)" stroke={COLORS.breach} strokeWidth="2.5" className="cage" />
      )}
      <text x={P.base.x} y={P.base.y + 108} textAnchor="middle" className="planet-name">Base Sepolia</text>
      <text x={P.base.x} y={P.base.y + 128} textAnchor="middle" className="planet-label">
        escrow {tok(state?.vaultCollateral)} dUSD
      </text>
      <text x={P.base.x} y={P.base.y + 146} textAnchor="middle" className="planet-label" fill={state?.homeFrozen ? COLORS.breach : state?.homeHeld ? COLORS.warn : COLORS.ok}>
        {state?.homeFrozen ? "ROUTE FROZEN" : state?.homeHeld ? "REDEMPTIONS HELD" : "route open"}
      </text>

      {/* Unichain */}
      <circle cx={P.uni.x} cy={P.uni.y} r={P.uni.r + 18} fill={COLORS.uni} opacity="0.18" filter="url(#soft)" />
      <circle cx={P.uni.x} cy={P.uni.y} r={P.uni.r} fill="url(#gUni)" />
      {state?.spokeFrozen && (
        <polygon points={hexagon(P.uni.x, P.uni.y, P.uni.r + 20)} fill="rgba(255,77,94,0.08)" stroke={COLORS.breach} strokeWidth="2.5" className="cage" />
      )}
      {state?.attackerQuarantined && (
        <g>
          <circle cx={P.uni.x + 74} cy={P.uni.y - 64} r="9" fill="#1a0a10" stroke={COLORS.breach} strokeWidth="2" />
          <text x={P.uni.x + 74} y={P.uni.y - 60} textAnchor="middle" fontSize="11" fill={COLORS.breach} fontFamily="JetBrains Mono">✕</text>
          <text x={P.uni.x + 84} y={P.uni.y - 82} textAnchor="end" className="planet-label" fill={COLORS.breach} fontSize="10">
            quarantined {attacker.slice(0, 6)}…{attacker.slice(-4)}
          </text>
        </g>
      )}
      <text x={P.uni.x} y={P.uni.y + 108} textAnchor="middle" className="planet-name">Unichain Sepolia</text>
      <text x={P.uni.x} y={P.uni.y + 128} textAnchor="middle" className="planet-label">
        supply {tok(state?.spokeSupply)} ndUSD
      </text>
      <text x={P.uni.x} y={P.uni.y + 146} textAnchor="middle" className="planet-label" fill={state?.spokeFrozen ? COLORS.breach : COLORS.ok}>
        {state?.spokeFrozen ? "ROUTE FROZEN" : "route open"}
      </text>

      {/* Lasna: Noether */}
      <circle cx={P.lasna.x} cy={P.lasna.y} r={P.lasna.r + 30} fill={coreColor} opacity="0.2" filter="url(#soft)" />
      {state?.clockOn && <circle cx={P.lasna.x} cy={P.lasna.y} r={P.lasna.r + 6} fill="none" stroke={COLORS.warn} strokeWidth="2" className="cron" />}
      <g className="ring-spin">
        <ellipse cx={P.lasna.x} cy={P.lasna.y} rx={P.lasna.r + 34} ry={16} fill="none" stroke={COLORS.cyan} strokeOpacity="0.55" strokeWidth="1.2" transform={`rotate(-22 ${P.lasna.x} ${P.lasna.y})`} />
      </g>
      <g className="ring-spin rev">
        <ellipse cx={P.lasna.x} cy={P.lasna.y} rx={P.lasna.r + 22} ry={P.lasna.r + 22} fill="none" stroke={COLORS.lasna} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 7" />
      </g>
      <circle cx={P.lasna.x} cy={P.lasna.y} r={P.lasna.r} fill="url(#gCore)" />
      <text x={P.lasna.x} y={P.lasna.y + 7} textAnchor="middle" fontFamily="Instrument Serif" fontStyle="italic" fontSize="24" fill="#0b0716">
        Noether
      </text>
      <text x={P.lasna.x} y={70} textAnchor="middle" className="planet-label" fill="#8b8799">
        REACTIVE LASNA · react() ledger
      </text>
      <text x={P.lasna.x} y={P.lasna.y + 96} textAnchor="middle" className="planet-val" fill={coreColor}>
        {["NORMAL", "ALERT · grace window open", "BREACHED · conservation broken"][mode]}
      </text>

      <g ref={layer} />
    </svg>
  );
}
