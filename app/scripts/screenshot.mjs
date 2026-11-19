// Regenerates docs/assets/observatory.png from the running Observatory, in real time (no fake clock),
// using a local Chromium-based browser over the DevTools protocol. No dependencies (Node >= 22).
//
//   node app/scripts/screenshot.mjs [url] [out.png] [waitSeconds]
//   BROWSER=/path/to/chrome node app/scripts/screenshot.mjs
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5173/";
const out = process.argv[3] || "docs/assets/observatory.png";
const wait = Number(process.argv[4] || 18);
const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const bin = candidates.find((p) => existsSync(p));
if (!bin) throw new Error("no Chromium-based browser found; set BROWSER");

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(bin, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "noether-shot-"))}`,
  "--window-size=1440,1000",
  "about:blank",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
}
if (!target) throw new Error("browser did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url });
console.log(`waiting ${wait}s for live data…`);
await sleep(wait * 1000);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 1000, scale: 1 } });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`wrote ${out}`);
ws.close();
proc.kill();
process.exit(0);
