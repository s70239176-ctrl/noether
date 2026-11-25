// Real-time screen recorder over the DevTools protocol (headless Edge/Chrome, no dependencies, Node >= 22).
// Captures Page.startScreencast frames with their timestamps and turns them into a constant 30 fps clip,
// so what you see is exactly what the page did, at the speed it did it.
//
//   node video/record.mjs <url> <out.mp4> <seconds> [timeline.json]
//
// timeline.json: [{ "at": 2.5, "js": "document.querySelector('button').click()", "mark": "clicked" },
//                 { "at": 5, "until": "document.body.innerText.includes('BREACHED')", "timeout": 120, "mark": "breached" }]
// "until" steps block the timeline (not the recording) until the condition is true. Marks (seconds from the
// recording start) are written next to the clip as <out>.marks.json, for the editor.
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const FF =
  process.env.FFMPEG ||
  "C:/Users/User/AppData/Roaming/Python/Python314/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
const [url, out, secArg, timelineArg] = process.argv.slice(2);
const seconds = Number(secArg || 10);
const timeline = timelineArg ? JSON.parse(readFileSync(timelineArg, "utf8")) : [];
const W = Number(process.env.RW || 1920), H = Number(process.env.RH || 1080);

const bin = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean).find((p) => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
// HEADED=1 uses a real (GPU-composited) window parked off-screen: far higher frame rates than headless.
// ZOOM=1.333 lays the page out at 1440x810 CSS pixels and captures it at 1920x1080.
const ZOOM = Number(process.env.ZOOM || 1);
const proc = spawn(bin, [
  ...(process.env.HEADED ? [`--window-position=${process.env.WINPOS || "-2600,0"}`, "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--no-first-run", "--no-default-browser-check"] : ["--headless=new"]),
  "--hide-scrollbars", "--force-color-profile=srgb", "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "noether-rec-"))}`,
  `--window-size=${W},${H}`, "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) throw new Error("browser did not start");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const frames = [];
const dir = mkdtempSync(join(tmpdir(), "noether-frames-"));
let sessionStart = null;
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Page.screencastFrame") {
    const { data, metadata, sessionId } = msg.params;
    const p = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(p, Buffer.from(data, "base64"));
    frames.push({ t: metadata.timestamp, p });
    ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId } }));
  }
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: Math.round(W / ZOOM), height: Math.round(H / ZOOM), deviceScaleFactor: ZOOM, mobile: false });
await send("Page.enable");
await send("Runtime.enable");
const manual = url.includes("manual=1");
await send("Page.navigate", { url });
// let fonts and first data settle before rolling
for (let i = 0; i < 100; i++) { if ((await evaluate("document.readyState")) === "complete") break; await sleep(100); }
await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
if (process.env.INJECT) await evaluate(readFileSync(process.env.INJECT, "utf8"));
await sleep(Number(process.env.SETTLE || 1500));

await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now() / 1000;
if (manual) await evaluate("window.__start && window.__start(), true");
const marks = {};
const runTimeline = (async () => {
  for (const step of timeline) {
    // "at": absolute seconds from the start; "wait": seconds after the previous step finished
    const wait = step.at !== undefined ? t0 + step.at - Date.now() / 1000 : step.wait || 0;
    if (wait > 0) await sleep(wait * 1000);
    if (step.js) { try { await evaluate(step.js); } catch (e) { console.log("js error", e); } }
    if (step.until) {
      if (step.label) console.log(`  waiting: ${step.label}`);
      const deadline = Date.now() + (step.timeout || 120) * 1000;
      while (Date.now() < deadline && !(await evaluate(`!!(${step.until})`))) await sleep(250);
    }
    if (step.mark) { marks[step.mark] = +(Date.now() / 1000 - t0).toFixed(2); console.log(`  mark ${step.mark} @ ${marks[step.mark]}s`); }
  }
})();
// the recording runs for `seconds`, or until the timeline finishes plus `seconds` tail if TAIL is set
await sleep(seconds * 1000);
if (process.env.WAIT_TIMELINE) { await runTimeline; await sleep(Number(process.env.WAIT_TIMELINE) * 1000); }
await send("Page.stopScreencast");
const t1 = Date.now() / 1000;
ws.close();
proc.kill();

// frames -> constant 30 fps via the concat demuxer with per-frame durations
const base = frames[0]?.t ?? t0;
const lines = [];
frames.forEach((f, i) => {
  const p = f.p;
  const next = i + 1 < frames.length ? frames[i + 1].t : base + (t1 - t0);
  lines.push(`file '${p.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
});
lines.push(`file '${join(dir, `${String(frames.length - 1).padStart(6, "0")}.jpg`).replace(/\\/g, "/")}'`);
writeFileSync(join(dir, "list.txt"), lines.join("\n"));
mkdirSync(dirname(out), { recursive: true });
const r = spawnSync(FF, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
  "-vf", `scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", out], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
// marks are relative to the first frame
const shift = base - t0;
for (const k of Object.keys(marks)) marks[k] = +(marks[k] - shift).toFixed(2);
writeFileSync(out + ".marks.json", JSON.stringify({ length: +(t1 - t0 - shift).toFixed(2), marks }, null, 2));
console.log(`${out}: ${frames.length} frames over ${(t1 - t0).toFixed(1)}s`, r.status === 0 ? "ok" : "FFMPEG FAILED");
process.exit(r.status ?? 1);
