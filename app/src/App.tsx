import { useEffect } from "react";
import { useNoether } from "./lib/noether";
import { Observatory } from "./components/Observatory";
import { Brain, Console, CoverPanel, Footer, Incident, Ladder, LawPanel, Seismograph } from "./components/Panels";

const MODES = ["NORMAL", "ALERT", "BREACHED"];

export function App() {
  const { cfg, state, events, heads, error, lastSync } = useNoether();
  const mode = state?.mode ?? 0;

  useEffect(() => {
    document.body.classList.toggle("breached", mode === 2);
    document.title = mode === 2 ? "⛔ BREACHED · Noether Observatory" : "Noether Observatory";
  }, [mode]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="word">Noether</span>
          <span className="sub">conservation observatory</span>
        </div>
        <div className="pulses">
          <span className="pulse c-base"><span className="dot" />Base #{heads.base ?? "…"}</span>
          <span className="pulse c-lasna"><span className="dot" />Lasna #{heads.lasna ?? "…"}</span>
          <span className="pulse c-uni"><span className="dot" />Unichain #{heads.unichain ?? "…"}</span>
          <span className="pulse" title="last sync">{lastSync ? `synced ${Math.max(0, Math.round((Date.now() - lastSync) / 1000))}s` : "syncing"}</span>
        </div>
        <span className={`modepill m${mode}`}>{state ? MODES[mode] : "…"}</span>
      </header>

      <main className="wrap">
        <section className="grid g-hero">
          <LawPanel state={state} />
          <div className="panel observatory">
            <div className="obs-head">
              <div className="eyebrow" style={{ marginBottom: 0, width: 260 }}><span className="n">02</span> Live map</div>
              <div className="obs-legend">
                <span><i style={{ background: "#4a82ff" }} />Base events</span>
                <span><i style={{ background: "#ff4fc3" }} />Unichain events</span>
                <span><i style={{ background: "#ff4d5e" }} />Noether callbacks</span>
              </div>
            </div>
            <Observatory state={state} events={events} attacker={cfg?.attacker ?? ""} />
          </div>
        </section>

        <section className="grid">
          <Ladder state={state} events={events} />
        </section>

        <section className="grid g-2">
          <Console cfg={cfg} state={state} />
          <Incident cfg={cfg} events={events} />
        </section>

        <section className="grid g-3-2">
          <Brain events={events} />
          <CoverPanel state={state} events={events} cfg={cfg} />
        </section>

        <section className="grid">
          <Seismograph cfg={cfg} events={events} />
        </section>

        <Footer cfg={cfg} />
      </main>
      {error && <div className="errbar">RPC hiccup: {error} (retrying)</div>}
    </>
  );
}
