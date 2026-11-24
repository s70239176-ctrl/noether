// Injected into the Observatory before recording: a visible cursor with click ripples, text-based element lookup,
// section jumps and React-friendly slider sweeps. Pure presentation; it never touches chain state itself
// (the buttons it clicks call the local operator server exactly like a person would).
(() => {
  const css = document.createElement("style");
  css.textContent = `
  #vcur{position:fixed;left:960px;top:700px;width:30px;height:30px;z-index:99999;pointer-events:none;transition:left .7s cubic-bezier(.3,.7,.2,1),top .7s cubic-bezier(.3,.7,.2,1);filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))}
  .vrip{position:fixed;z-index:99998;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #8ab8ff;pointer-events:none;animation:vrip .7s ease-out forwards}
  @keyframes vrip{to{transform:scale(5);opacity:0}}
  html{scroll-behavior:auto!important} .nav,.announce{display:none!important}`;
  document.head.appendChild(css);
  const cur = document.createElement("div");
  cur.id = "vcur";
  cur.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#01040e" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(cur);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
  window.__jump = (target, off = 90) => {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return false;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    return true;
  };
  window.__move = async (el) => {
    const r = el.getBoundingClientRect();
    cur.style.left = r.left + Math.min(r.width * 0.5, 160) + "px";
    cur.style.top = r.top + r.height * 0.5 + "px";
    await sleep(800);
  };
  window.__click = async (el) => {
    if (typeof el === "string") el = document.querySelector(el);
    if (!el) return false;
    await window.__move(el);
    const r = el.getBoundingClientRect();
    const rip = document.createElement("div");
    rip.className = "vrip";
    rip.style.left = r.left + Math.min(r.width * 0.5, 160) + "px";
    rip.style.top = r.top + r.height * 0.5 + "px";
    document.body.appendChild(rip);
    setTimeout(() => rip.remove(), 800);
    el.click();
    return true;
  };
  window.__slide = async (i, to, ms = 2200) => {
    const input = document.querySelectorAll(".sliders input[type=range]")[i];
    if (!input) return false;
    await window.__move(input);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const from = Number(input.value);
    const steps = Math.max(8, Math.round(ms / 60));
    const r = input.getBoundingClientRect();
    for (let k = 1; k <= steps; k++) {
      const v = from + ((to - from) * k) / steps;
      set.call(input, v.toFixed(2));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      cur.style.transition = "none";
      cur.style.left = r.left + r.width * v + "px";
      await sleep(ms / steps);
    }
    cur.style.transition = "";
    return true;
  };
  window.__mode = () => document.querySelector(".mode-chip")?.textContent?.trim() || "";
  window.__log = () => document.querySelector("#console .log")?.innerText || "";
})();
true;
