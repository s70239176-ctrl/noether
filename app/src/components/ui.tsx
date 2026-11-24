import { useEffect, useRef, type ReactNode } from "react";

/** Fades and lifts its children into view the first time they scroll on screen. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function SectionHead({ pill, title, sub, left = false }: { pill: string; title: ReactNode; sub?: ReactNode; left?: boolean }) {
  return (
    <Reveal className={`sec-head ${left ? "left" : ""}`}>
      <span className="pill">{pill}</span>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </Reveal>
  );
}

export function Spark({ values, color = "#2086ff", fill = true }: { values: number[]; color?: string; fill?: boolean }) {
  const v = values.length > 1 ? values : [0, 0];
  const max = Math.max(...v, 1e-9);
  const min = Math.min(...v);
  // A flat series sits mid-tile instead of on the floor.
  const pts = v.map((y, i) => [(i / (v.length - 1)) * 100, max === min ? 26 : 46 - ((y - min) / (max - min)) * 40]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const id = `sg${color.replace(/[^0-9a-z]/gi, "")}`;
  return (
    <svg className="spark" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && max !== min && <path d={`${d} L100,50 L0,50 Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Half-ring gauge in the style of a health score dial. */
export function Ring({ value, color }: { value: number; color: string }) {
  const r = 52;
  const len = Math.PI * r;
  const k = Math.max(0, Math.min(1, value / 100));
  return (
    <svg viewBox="0 0 140 84" width="100%" style={{ maxWidth: 190 }} aria-hidden="true">
      <path d="M18 74 A52 52 0 0 1 122 74" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" strokeLinecap="round" />
      {k > 0.004 && <path
        d="M18 74 A52 52 0 0 1 122 74"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${len * k} ${len}`}
        style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.4s" }}
      />}
    </svg>
  );
}

export const Sparkle = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.5c.6 4.8 2.7 8.4 10.5 10.5-7.8 2.1-9.9 5.7-10.5 10.5-.6-4.8-2.7-8.4-10.5-10.5C9.3 9.9 11.4 6.3 12 1.5z" fill="#fff" />
  </svg>
);
