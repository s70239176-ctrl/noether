// Deterministic renderer for the explainer cards: every CSS animation on the page is paused and seeked to
// frame n / 30, then screenshotted, so timing is exact no matter how slow the machine paints.
//
//   node video/render_cards.mjs [sceneId ...]     -> video/build/clips/<sceneId>.mp4
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FF = process.env.FFMPEG ||
  "C:/Users/User/AppData/Roaming/Python/Python314/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
const FPS = 30, W = 1920, H = 1080;
const script = JSON.parse(readFileSync(join(ROOT, "script.json"), "utf8"));
const durations = JSON.parse(readFileSync(join(ROOT, "build", "durations.json"), "utf8"));
const only = new Set(process.argv.slice(2));

const bin = [process.env.BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean).find((p) => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(bin, ["--headless=new", "--hide-scrollbars", "--force-color-profile=srgb",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "noether-cards-"))}`,
  `--window-size=${W},${H}`, "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");

const page = pathToFileURL(join(ROOT, "cards", "index.html")).href;
for (const sc of script.scenes) {
  if (sc.type !== "card" || (only.size && !only.has(sc.id))) continue;
  const vo = durations[sc.id];
  const length = script.headPad + vo + script.tailPad;
  const frames = Math.round(length * FPS);
  await send("Page.navigate", { url: `${page}?s=${sc.card}&d=${vo}&delay=${script.headPad}&render=1` });
  for (let i = 0; i < 100; i++) { if ((await evaluate("document.readyState")) === "complete" && (await evaluate("!!window.__seek"))) break; await sleep(100); }
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(400);
  if (process.env.STILL) {
    const { writeFileSync } = await import("node:fs");
    await evaluate(`__seek(${(length - 0.5).toFixed(2)})`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    mkdirSync(join(ROOT, "build", "stills"), { recursive: true });
    writeFileSync(join(ROOT, "build", "stills", `${sc.id}.jpg`), Buffer.from(shot.result.data, "base64"));
    console.log("still", sc.id);
    continue;
  }
  const out = join(ROOT, "build", "clips", `${sc.id}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  const ff = spawn(FF, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), out], { stdio: ["pipe", "inherit", "inherit"] });
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await evaluate(`__seek(${(f / FPS).toFixed(4)})`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 93, captureBeyondViewport: false });
    if (!ff.stdin.write(Buffer.from(shot.result.data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`${sc.id}: ${frames} frames (${length.toFixed(2)}s) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ws.close();
proc.kill();
process.exit(0);
