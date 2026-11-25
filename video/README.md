# Demo video pipeline

The demo video is generated from source. Every frame and every sound is made here or captured live from the testnets.

| Step | Command | What it does |
|---|---|---|
| 1 | `python video/tts.py` | Renders the voice-over for each scene in [`script.json`](script.json) with a neural voice (edge-tts, `en-US-AndrewNeural`) |
| 2 | `python video/subs.py` | Gets the sentence timings used for the burned-in captions |
| 3 | `node video/render_cards.mjs` | Renders the explainer scenes from [`cards/index.html`](cards/index.html) frame by frame (paused CSS animations, seeked to n/30 s) |
| 4 | `node video/record.mjs http://127.0.0.1:5175/ video/build/raw/live.mp4 1 video/live/timeline.json` (with `INJECT` set to `video/live/helpers.js` followed by `video/live/hud.js`, plus `WAIT_TIMELINE=1 ZOOM=1.3333`) | Records the Observatory in real time while the timeline clicks the operator console. These are real transactions on Base Sepolia, Unichain Sepolia and Reactive Lasna. It writes event marks next to the clip |
| 5 | `python video/compose.py` | Cuts the live footage by its marks, adds "T+n s" real-time stamps wherever time was cut, burns in the captions, and mixes voice, synthesized effects ([`audio.py`](audio.py)) and the ambient bed |

Output: `video/out/noether-demo.mp4` (1080p30, H.264 and AAC). Build products in `video/build/` and `video/out/` are not committed.

Requirements: Python 3 with `numpy`, `edge-tts` and `imageio-ffmpeg`; Node 22 or later; and Edge or Chrome. Step 4 needs the operator server (`PORT=5175 node app/server.mjs`, after `npm run build` in `app/`) and a ledger in the NORMAL state.
