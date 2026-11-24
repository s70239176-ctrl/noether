import { useEffect, useState } from "react";
import { useNoether } from "./lib/noether";
import { Observatory } from "./components/Observatory";
import { Brain, Console, CoverPanel, Incident, Seismograph } from "./components/Panels";
import { Dashboard } from "./components/Dashboard";
import { Benefits, Cta, Evidence, Faq, Integrations, Overview, SiteFooter, Steps } from "./components/Sections";
import { Reveal, SectionHead, Sparkle } from "./components/ui";
import { MonitorSection } from "./components/Monitor";

const MODES = ["NORMAL", "ALERT", "BREACHED"];
const REPO = "https://github.com/s70239176-ctrl/noether";
const TRUST = ["Hyperlane Mailbox v3", "Reactive Lasna", "Base Sepolia", "Unichain Sepolia", "HypERC20 Warp Route", "Foundry", "viem"];

export function App() {
  const { cfg, state, events, heads, error, lastSync } = useNoether();
  const mode = state?.mode ?? 0;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("breached", mode === 2);
    document.title = mode === 2 ? "⛔ BREACHED · Noether" : "Noether · Live conservation dashboard";
  }, [mode]);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  return (
    <>
      <div className="announce">
        Live on Base Sepolia, Unichain Sepolia and Reactive Lasna
        <a href="#evidence">See the recorded attacks ›</a>
      </div>
      <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
        <div className="container nav-in">
          <a href="#top" className="logo"><Sparkle /> Noether</a>
          <div className="nav-links">
            <a href="#overview">Overview</a>
            <a href="#how">How it works</a>
            <a href="#console">Live console</a>
            <a href="#monitor">Monitor</a>
            <a href="#evidence">Evidence</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-right">
            <span className={`mode-chip m${mode}`}><span className="status-dot" />{state ? MODES[mode] : "…"}</span>
            <a className="btn sm" href={REPO} target="_blank" rel="noreferrer">View on GitHub</a>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="beams" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="container">
          <Reveal>
            <a className="hero-badge" href="#benefits"><b>Buildathon 2026</b> Reactive Omni · Every Second Counts ›</a>
            <h1>Every bridge, one<br />conservation law</h1>
            <p className="sub">
              Noether watches both ends of a live Hyperlane route from Reactive Lasna. The moment value appears that was never sent, every chain freezes.
            </p>
            <div className="hero-ctas">
              <a className="btn lg" href="#console">Watch it live</a>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <Dashboard state={state} events={events} heads={heads} lastSync={lastSync} />
          </Reveal>
        </div>
        <div className="hero-fade" />
      </header>

      <div className="trust container">
        <p>Running live on production infrastructure</p>
        <div className="marquee">
          <div className="track">
            {[...TRUST, ...TRUST].map((t, i) => (
              <span key={i}><Sparkle /> {t}</span>
            ))}
          </div>
        </div>
      </div>

      <Overview state={state} events={events} />
      <Steps state={state} />

      <section className="sec" id="map">
        <div className="container">
          <SectionHead pill="Live map" title="Watch value move between chains" sub="Hyperlane messages cross the route, logs stream into Noether, and its callbacks fire back to every chain." />
          <Reveal>
            <div className="card observatory" style={{ padding: 0 }}>
              <Observatory state={state} events={events} attacker={cfg?.attacker ?? ""} />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec" id="console">
        <div className="container">
          <SectionHead pill="Live console" title="Run the attack yourself" sub="Every button sends real transactions on the testnets, and the dossier rebuilds the loop from on-chain timestamps." />
          <div className="grid-2">
            <Reveal><Console cfg={cfg} state={state} /></Reveal>
            <Reveal delay={90}><Incident cfg={cfg} events={events} /></Reveal>
          </div>
        </div>
      </section>

      <MonitorSection cfg={cfg} state={state} events={events} />

      <Benefits />

      <section className="sec" id="features">
        <div className="container">
          <SectionHead pill="Features" title="Built for the minutes that matter" sub="Cover that can't be front-run, a neural network in the loop, and every event on the record." />
          <div className="feature" id="cover">
            <Reveal>
              <span className="pill">Cover</span>
              <h3>Cover that can't be front-run</h3>
              <p>Sales pause the moment a delivery looks suspicious, and payout eligibility is fixed by the forged event's own timestamp.</p>
              <ul className="ticks">
                <li>Sales pause at the Suspect rung, before a violation is confirmed</li>
                <li>Policies bought at or after the forged event are excluded</li>
                <li>Payouts settle themselves through a reactive loop, with no claims</li>
              </ul>
            </Reveal>
            <Reveal delay={90}><CoverPanel state={state} events={events} cfg={cfg} /></Reveal>
          </div>
          <div className="feature flip" id="scorer">
            <Reveal>
              <span className="pill">Neural</span>
              <h3>A neural network inside react()</h3>
              <p>The same integer weights that run on-chain, live in your browser. Drag the features and watch the verdict move.</p>
              <ul className="ticks">
                <li>Bit-exact with the Python model that trained it</li>
                <li>About 35k gas per forward pass</li>
                <li>Can only accelerate a freeze, never clear one</li>
              </ul>
            </Reveal>
            <Reveal delay={90}><Brain events={events} /></Reveal>
          </div>
          <div className="feature" id="events">
            <Reveal>
              <span className="pill">Record</span>
              <h3>Every event, on the record</h3>
              <p>Dispatches, deliveries, suspects, callbacks, freezes and payouts across three chains, each linked to its transaction.</p>
              <ul className="ticks">
                <li>Read straight from chain logs, no indexer</li>
                <li>Topic-filtered, so other apps on the Mailbox don't appear</li>
                <li>Click any mark to open the explorer</li>
              </ul>
            </Reveal>
            <Reveal delay={90}><Seismograph cfg={cfg} events={events} /></Reveal>
          </div>
        </div>
      </section>

      <Integrations />
      <Evidence />
      <Faq />
      <Cta />
      <SiteFooter cfg={cfg} />

      {error && <div className="errbar">RPC hiccup: {error} (retrying)</div>}
    </>
  );
}
