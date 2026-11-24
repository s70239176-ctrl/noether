# Demo video script (about 3 minutes, user first)

The finished demo video (4.3 minutes, with voice-over, captions and live testnet footage) is generated from source by the pipeline in [`video/`](../video/README.md); its scene-by-scene narration is in [`video/script.json`](../video/script.json). The table below is the shorter version to record by hand.

Lead with the person whose money is at risk, then show the mechanism. Every shot uses the real testnets and the Observatory.

**Before recording**
- Run the local operator console (`cd app && npm run dev`, then open http://127.0.0.1:5173).
- If the route shows BREACHED, click **Resolve the incident** and wait until the header shows NORMAL.
- Optional: open https://noether-ashy.vercel.app in a second tab, to show the public view updating at the same time.

| Time | Picture | Voice-over (say it in your own words) |
|---|---|---|
| 0:00–0:20 | Hero of the dashboard, NORMAL | "You bridged your stablecoins from Base to Unichain. On Unichain your tokens are an IOU, backed by collateral locked on Base. That promise only holds if nobody can mint IOUs that nothing backs." |
| 0:20–0:40 | Scroll to the incident table in the README, or say it over the hero | "That's how the biggest bridge hacks happened: Ronin, Wormhole, Nomad. Each chain saw a valid-looking transaction. Only someone looking at both chains could see the books didn't balance." |
| 0:40–1:00 | Live map: Base, Lasna, Unichain | "Noether is that someone. It's a reactive contract on Reactive Network that reads both ends of a real Hyperlane route, and keeps one ledger: everything delivered must have been sent." |
| 1:00–1:25 | Console: click **Bridge 1,000 dUSD**; map particles; dashboard stays NORMAL | "Here's a normal transfer. The dispatch on Base and the delivery on Unichain are matched by message id. Nothing happens, and that's the point." |
| 1:25–1:55 | Console: arm and fire **Forge a 1,000,000 mint** | "Now the bridge's relayer key is stolen. The attacker mints a million tokens with nothing behind them, and Hyperlane accepts it, because the key is valid." |
| 1:55–2:25 | Dashboard flips to BREACHED; cages appear on the map; dossier fills in | "In the same second, Noether's neural scorer flags it, and one reaction freezes the route on both chains, quarantines the attacker, and closes cover sales. Here's each step with its on-chain timestamp." |
| 2:25–2:40 | Console: **Try again** (rejected); cover panel shows payout | "The attacker tries again and is rejected. The attempt to buy cover after the hack started is excluded, and honest policyholders were paid with no claims." |
| 2:40–3:00 | Monitor mode section, then the Protect section of the README | "And you don't have to rebuild your bridge. Monitor mode watches any Hyperlane route with zero integration, and one command puts Enforce mode in front of an existing route in about two minutes. Every second counts, and every unit is accounted for." |

**Say plainly if it happens on camera:** a freeze is only as fast as Reactive's callback delivery. If callbacks are slow while recording, show the "callbacks landed n / 4" counter, explain it, and cut to the recorded run in `docs/LIVE_EVIDENCE.md`.
