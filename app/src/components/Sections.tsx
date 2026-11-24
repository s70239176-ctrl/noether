import type { Config, LiveState, NEvent } from "../lib/noether";
import { addrUrl, short, tok, CHAIN_LABEL } from "../lib/format";
import { Reveal, SectionHead, Sparkle } from "./ui";

const REPO = "https://github.com/s70239176-ctrl/noether";

// ------------------------------------------------------------------ overview bento

export function Overview({ state, events }: { state: LiveState | null; events: NEvent[] }) {
  const esc = Number(state?.escrowed ?? 0n) / 1e18;
  const circ = Number(state?.circulating ?? 0n) / 1e18;
  const unbacked = Math.max(0, circ - esc);
  const backedShare = circ === 0 ? 1 : Math.min(1, esc / circ);
  const mode = state?.mode ?? 0;
  const lastBreak = [...events].reverse().find((e) => e.name === "ConservationBroken");
  const fan = lastBreak ? events.filter((e) => e.name === "CallbackSent" && e.tx === lastBreak.tx).length : 4;
  const R = 54;
  const C = 2 * Math.PI * R;
  return (
    <section className="sec" id="overview">
      <div className="container">
        <SectionHead
          pill="Overview"
          title={<>Everything a bridge needs<br />to fail safely</>}
          sub="One reactive contract reads both ends of a live Hyperlane route and enforces a single law."
        />
        <div className="grid-3">
          <Reveal>
            <div className="card">
              <h3>Both ends, one ledger</h3>
              <p className="d">Dispatches on Base and deliveries on Unichain, matched by Hyperlane message id inside one react().</p>
              <div className="viz">
                <div style={{ display: "grid", gap: 22, justifyItems: "center" }}>
                  <div className="node-row">
                    <div className="node">Base</div>
                    <div className="node">Mail</div>
                    <div className="node">ISM</div>
                    <div className="node">Uni</div>
                  </div>
                  <svg width="220" height="34" viewBox="0 0 220 34" aria-hidden="true">
                    <path d="M23 0 V12 H197 V0 M83 0 V12 M137 0 V12 M110 12 V34" fill="none" stroke="rgba(138,184,255,0.35)" strokeWidth="1.2" />
                  </svg>
                  <div className="node core">
                    <Sparkle />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="card">
              <h3>Live conservation</h3>
              <p className="d">Collateral escrowed on Base against supply circulating on Unichain, rebuilt from events in real time.</p>
              <div className="viz">
                <svg width="200" height="200" viewBox="0 0 160 160" aria-hidden="true">
                  <circle cx="80" cy="80" r={R + 14} fill="rgba(32,134,255,0.06)" />
                  <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
                  <circle cx="80" cy="80" r={R} fill="none" stroke="#2086ff" strokeWidth="16" strokeDasharray={`${C * backedShare} ${C}`} transform="rotate(-90 80 80)" style={{ transition: "stroke-dasharray 0.8s" }} />
                  {unbacked > 0 && (
                    <circle cx="80" cy="80" r={R} fill="none" stroke="#ff4d5e" strokeOpacity="0.75" strokeWidth="16" strokeDasharray={`${C * (1 - backedShare)} ${C}`} strokeDashoffset={-C * backedShare} transform="rotate(-90 80 80)" />
                  )}
                  <text x="80" y="78" textAnchor="middle" fill="#fff" fontSize="17" fontWeight="600" fontFamily="Inter">{tok(state?.circulating)}</text>
                  <text x="80" y="95" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="Inter">CIRCULATING</text>
                </svg>
                <span className="bubble" style={{ left: 6, top: 52 }}>Escrowed {tok(state?.escrowed)}</span>
                <span className="bubble" style={{ right: 6, top: 22, color: unbacked > 0 ? "#ff8a96" : undefined }}>
                  {unbacked > 0 ? `Unbacked ${tok(BigInt(Math.round(unbacked)) * 10n ** 18n)}` : "Fully backed"}
                </span>
                <span className="bubble" style={{ right: 16, bottom: 18 }}>{["Law holds", "Grace window", "Frozen"][mode]}</span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="card">
              <h3>Neural escalation</h3>
              <p className="d">A 6-8-1 network inside react() decides whether to skip the grace window. It can only make Noether faster.</p>
              <div className="viz">
                <div style={{ display: "grid", justifyItems: "center" }}>
                  <span className="analyzer">Neural scorer ✦</span>
                  <div className="alert-card">
                    <b>✦ Forgery detected</b>
                    1,000,000 delivered on Unichain with no dispatch behind it. p ≈ 99.75%, freezing every chain in this reaction.
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <Reveal>
            <div className="card">
              <h3>A ladder, not a hair trigger</h3>
              <p className="d">Events can arrive out of order across chains, so Noether climbs: suspect, neural, then violation.</p>
              <div className="viz" style={{ minHeight: 150 }}>
                <div className="node-row" style={{ gap: 10, flexWrap: "wrap" }}>
                  {["Normal", "Suspect", "Neural", "Violation"].map((n, i) => {
                    const on = (i === 0 && mode === 0) || (i === 1 && mode === 1) || (i >= 2 && mode === 2);
                    return (
                      <span key={n} className={`chip-l ${on ? (i === 3 ? "red" : "hot") : ""}`}>
                        0{i + 1} · {n}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="card">
              <h3>One reaction, every chain</h3>
              <p className="d">A violation fans out callbacks to the guards on both chains and the cover pool in a single reactive transaction.</p>
              <div className="viz" style={{ minHeight: 150 }}>
                <svg width="100%" height="140" viewBox="0 0 360 140" aria-hidden="true">
                  {["Base", "Cover", "Unichain", "Quarantine", "", "", ""].map((l, i) => {
                    const hot = i < fan;
                    const h = hot ? 70 + ((i * 13) % 30) : 34 + ((i * 7) % 18);
                    return (
                      <g key={i}>
                        <rect x={14 + i * 49} y={118 - h} width="38" height={h} rx="8" fill={hot ? "url(#barHot)" : "rgba(255,255,255,0.06)"} stroke={hot ? "rgba(138,184,255,0.6)" : "rgba(255,255,255,0.08)"} />
                        {l && <text x={33 + i * 49} y="134" textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.55)" fontFamily="Inter">{l}</text>}
                      </g>
                    );
                  })}
                  <defs>
                    <linearGradient id="barHot" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4d9dff" />
                      <stop offset="100%" stopColor="#0e67cc" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ steps

export function Steps({ state }: { state: LiveState | null }) {
  const subs: [string, string, boolean][] = [
    ["Mailbox · Dispatch (route)", "Base", true],
    ["NoetherIsm · Inbound", "Base", true],
    ["Mailbox · Dispatch (route)", "Unichain", true],
    ["NoetherIsm · Inbound", "Unichain", true],
    ["Cron1 (only if suspicious)", "Lasna", !!state?.clockOn],
  ];
  return (
    <section className="sec" id="how">
      <div className="container">
        <SectionHead
          left
          pill="Steps"
          title="Deploy once, enforce forever"
          sub="Noether subscribes to both chains, matches every message, and freezes the route the moment the books stop balancing."
        />
        <div className="grid-3">
          <Reveal>
            <div className="card">
              <div className="step-n">1. Subscribe</div>
              <p className="d" style={{ marginTop: 6 }}>Five subscriptions across three chains, registered in the constructor and inside react().</p>
              <div className="viz" style={{ placeItems: "stretch", minHeight: 0 }}>
                <table className="table">
                  <thead>
                    <tr><th>Event</th><th>Chain</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {subs.map(([e, c, on]) => (
                      <tr key={e + c}>
                        <td>{e}</td>
                        <td>{c}</td>
                        <td><span className={on ? "on" : "off"}>{on ? "Live" : "Dormant"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="card">
              <div className="step-n">2. Match</div>
              <p className="d" style={{ marginTop: 6 }}>Every Inbound must have exactly one Dispatch with the same message id, amount, recipient and route.</p>
              <div className="viz">
                <svg width="100%" height="150" viewBox="0 0 300 150" aria-hidden="true">
                  <defs>
                    <linearGradient id="matchFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2086ff" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#2086ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 120 C40 110 60 118 90 96 S150 92 180 70 S240 60 300 30 L300 150 L0 150 Z" fill="url(#matchFill)" />
                  <path d="M0 120 C40 110 60 118 90 96 S150 92 180 70 S240 60 300 30" fill="none" stroke="#4d9dff" strokeWidth="2" />
                  <circle cx="240" cy="52" r="5" fill="#fff" stroke="#4d9dff" strokeWidth="2" />
                </svg>
                <span className="bubble" style={{ right: 10, top: 6 }}>
                  <span style={{ color: "#3ddc97" }}>✓</span> Dispatch ⇄ Inbound matched
                </span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="card">
              <div className="step-n">3. Freeze</div>
              <p className="d" style={{ marginTop: 6 }}>No dispatch behind a delivery? Every chain freezes, the recipient is traced, and cover pays out.</p>
              <div className="viz">
                <div className="chips">
                  <span className="chip-l">Unichain route frozen</span>
                  <span className="chip-l hot">✦ Noether · conservation broken</span>
                  <span className="chip-l">Base route frozen · cover paid</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ benefits

export function Benefits() {
  const stats: [string, string, string][] = [
    ["0 s", "Decision time", "Noether reacts in the same second as the forged mint"],
    ["4", "Callbacks, one tx", "Base guard, cover, Unichain guard and a quarantine"],
    ["416k", "Worst-case gas", "Under Omni's 900k cap for a reactive transaction"],
    ["39", "Tests", "On Hyperlane's real Mailbox, ISM and token routers"],
  ];
  return (
    <section className="sec" id="benefits">
      <div className="container">
        <SectionHead pill="Benefits" title="Why it holds up" sub="Measured on testnet and in tests, not asserted." />
        <div className="stats">
          {stats.map(([b, l, e], i) => (
            <Reveal key={l} delay={i * 80}>
              <div className="card stat-card">
                <div className="big">{b}</div>
                <div className="lab">{l}</div>
                <div className="ex">{e}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ integrations

export function Integrations() {
  const items: [string, string, number, number][] = [
    ["Hyperlane", "Mailbox v3", -230, -110],
    ["Reactive", "Lasna", 210, -120],
    ["Base", "Sepolia", -280, 30],
    ["Unichain", "Sepolia", 270, 40],
    ["Foundry", "31 tests", -170, 140],
    ["viem", "live RPC", 180, 150],
  ];
  return (
    <section className="sec" id="stack">
      <div className="container">
        <SectionHead pill="Stack" title="Everything connects through Noether" sub="Production Hyperlane contracts, Reactive Omni, two L2 testnets and a fully reproducible toolchain." />
        <Reveal>
          <div className="card orbit-wrap">
            <div className="orbit" style={{ width: 300, height: 300 }} />
            <div className="orbit" style={{ width: 520, height: 330 }} />
            <div className="node core" style={{ width: 84, height: 84, borderRadius: 22 }}>
              <Sparkle />
            </div>
            {items.map(([n, s, x, y]) => (
              <div key={n} className="orbit-item" style={{ transform: `translate(${x}px, ${y}px)` }}>
                {n} <small>{s}</small>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ evidence (testimonial layout)

export function Evidence() {
  const runs: [string, string, string, string][] = [
    [
      "A forged 1,000,000 mint was accepted by Hyperlane's real Mailbox on Unichain. Noether froze Base one second later and Unichain the second after, then paid cover with no claim.",
      "Run 1 · forged mint",
      "https://lasna.reactscan.net/tx/0xeb4b319520edcad88bae85da1f5be342c626d55d10b535d2ea0e5bf8831ce2c9",
      "R1",
    ],
    [
      "A forged release drained 100 dUSD of real collateral on Base. The Base route froze one second later, and the copycat drain was rejected by the frozen security module.",
      "Run 2 · collateral drain",
      "https://sepolia.basescan.org/tx/0x7345d2c636dceaa2b0fe0508c706f7cd5e2b73972bafcb11786e73f16ce9c8f9",
      "R2",
    ],
    [
      "During a 25-minute Reactive delivery stall, a front-runner bought cover before the hold landed. When the payout loop settled, that policy was excluded.",
      "Run 3 · from this console",
      "https://sepolia.basescan.org/tx/0x5ff700b31231e57392586926388f6dc493889642ee33b0e07a57f49333f272d0",
      "R3",
    ],
  ];
  return (
    <section className="sec" id="evidence">
      <div className="container">
        <SectionHead pill="Evidence" title="What the chains say" sub="Three live runs on testnet. Every sentence links to the transaction that proves it." />
        <div className="grid-3">
          {runs.map(([q, who, tx, av], i) => (
            <Reveal key={who} delay={i * 90}>
              <div className="card quote" style={{ height: "100%" }}>
                <div className="q">“{q}”</div>
                <div className="who">
                  <span className="av">{av}</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{who}</div>
                    <a href={tx} target="_blank" rel="noreferrer">{short(tx.split("/tx/")[1], 8, 6)} ↗</a>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <a className="btn ghost" href={`${REPO}/blob/main/docs/LIVE_EVIDENCE.md`} target="_blank" rel="noreferrer">
              Read the full evidence →
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ faq

export function Faq() {
  const qs: [string, string][] = [
    [
      "Why can't a single chain check this itself?",
      "Each chain only sees its own half of the ledger: Base sees collateral locked, Unichain sees tokens minted. An unbacked mint looks perfectly valid on Unichain. Only something that reads both chains at once can notice that nothing was locked, and that is exactly what a reactive contract on Lasna does.",
    ],
    [
      "Does Noether trust the bridge's relayer or validators?",
      "No. It is installed as the route's security module and wraps whatever verification the route uses, but it never relies on it. It audits the results: every delivery must match a dispatch by Hyperlane message id. That is why a compromised relayer key, the attack in the live demo, gets caught.",
    ],
    [
      "What happens if Reactive is slow?",
      "Noether's decision is made inside one reactive transaction, in the same second as the forged event. Delivering the freeze callbacks depends on Reactive's relayers: 1–2 s in our first two runs, 25 minutes during a testnet-wide stall in run 3. The dashboard shows callbacks landed versus requested so a stall is never hidden.",
    ],
    [
      "Is the AI in control?",
      "Only in one direction. The neural scorer can skip the grace window and freeze immediately when it is confident. It can never clear a suspect or lift a freeze; deterministic rules and human governance handle that.",
    ],
    [
      "Can I run the attack from this site?",
      "Not from the public site: the buttons need the route's operator key, which never leaves the operator's machine. Clone the repo and run the Observatory locally to execute every scenario on the real testnets.",
    ],
    [
      "What is real, and what is simulated?",
      "Hyperlane's Mailboxes, routers and security modules, Reactive Lasna, the callbacks and the cover pool are real and on-chain. The collateral token is a faucet token, the compromised key is the deployer's own, and the scorer's training data is synthetic.",
    ],
  ];
  return (
    <section className="sec" id="faq">
      <div className="container">
        <SectionHead pill="FAQ" title="Questions? Here's the honest version" />
        <Reveal>
          <div className="faq">
            {qs.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ cta + footer

export function Cta() {
  return (
    <div className="container">
      <Reveal>
        <div className="cta-band">
          <span className="pill">Live now</span>
          <h2>
            Every second counts.
            <br />
            Every unit is accounted for.
          </h2>
          <p>Watch the conservation law hold, or break and freeze, on three live chains.</p>
          <div className="hero-ctas">
            <a className="btn lg" href="#top">Open the live dashboard</a>
            <a className="btn lg ghost" href={REPO} target="_blank" rel="noreferrer">Read the code</a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

export function SiteFooter({ cfg }: { cfg: Config | null }) {
  const c = cfg?.contracts;
  return (
    <div className="container">
      <footer className="foot">
        <div>
          <div className="logo"><Sparkle /> Noether</div>
          <p className="mute" style={{ fontSize: 13.5, marginTop: 12, maxWidth: 320 }}>
            A cross-chain conservation law for a live Hyperlane Warp Route, enforced by Reactive Omni. Reactive Omni Buildathon 2026.
          </p>
        </div>
        <div>
          <h4>Explore</h4>
          <a href="#top">Live dashboard</a>
          <a href="#console">Operator console</a>
          <a href="#map">Live map</a>
          <a href="#evidence">Evidence</a>
        </div>
        <div>
          <h4>Build</h4>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPO}/blob/main/docs/DESIGN.md`} target="_blank" rel="noreferrer">Design doc</a>
          <a href={`${REPO}/blob/main/docs/LIVE_EVIDENCE.md`} target="_blank" rel="noreferrer">Live evidence</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT license</a>
        </div>
        <div>
          <h4>Contracts</h4>
          {c && (
            <>
              <a href={addrUrl(cfg, "lasna", c.ledger)} target="_blank" rel="noreferrer">Ledger · {CHAIN_LABEL.lasna}</a>
              <a href={addrUrl(cfg, "base", c.homeRouter)} target="_blank" rel="noreferrer">Warp route · Base</a>
              <a href={addrUrl(cfg, "unichain", c.spokeRouter)} target="_blank" rel="noreferrer">Warp route · Unichain</a>
              <a href={addrUrl(cfg, "base", c.cover)} target="_blank" rel="noreferrer">Cover pool · Base</a>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
