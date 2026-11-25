// Live HUD rendered by the page itself: a ticking UTC wall clock, so the take visibly runs in real time.
(() => {
  const s = document.createElement("style");
  s.textContent = `*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
  #vhud{position:fixed;right:22px;bottom:22px;z-index:99997;font:600 15px/1 "IBM Plex Mono",ui-monospace,monospace;color:#fff;
  background:rgba(1,4,14,.86);border:1px solid rgba(255,77,94,.55);border-radius:10px;padding:9px 12px;display:flex;gap:9px;align-items:center}
  #vhud i{width:9px;height:9px;border-radius:50%;background:#ff4d5e;box-shadow:0 0 10px #ff4d5e;animation:vh 1s steps(2) infinite}
  @keyframes vh{50%{opacity:.25}}`;
  document.head.appendChild(s);
  const h = document.createElement("div");
  h.id = "vhud";
  document.body.appendChild(h);
  const tick = () => { h.innerHTML = `<i></i>LIVE · testnet · ${new Date().toISOString().slice(11, 19)} UTC`; };
  tick();
  setInterval(tick, 200);
  return true;
})();
