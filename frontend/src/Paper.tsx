import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

/** The paper behind a page: an aged sheet with a torn-looking edge and a fine
 *  grain. Decoration only.
 *
 *  It is drawn as plain shapes and an image, with no live filters. The edge is
 *  a jagged outline worked out once for the sheet's size, and the grain is a
 *  small tile repeated. (It used to be an SVG noise and displacement filter over
 *  the whole sheet, which the browser recomputed on every repaint: in Firefox
 *  browsers such as Zen that kept the laptop warm.) */

/** Kept so pages that render it still build; there is no filter to define now. */
export function PaperDefs() {
  return null;
}

// a small seeded random, so the edge is the same on every load
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1D fractal noise in -1..1: a few octaves of smoothed random values. */
function noise1(seed: number) {
  const octaves = [
    { wave: 40, amp: 1 },
    { wave: 12, amp: 0.6 },
    { wave: 4, amp: 0.45 },
  ].map((o, i) => {
    const r = rng(seed * 31 + i);
    const vals: number[] = [];
    return { ...o, at: (k: number) => (vals[k] ??= (() => { while (vals.length <= k) vals.push(r() * 2 - 1); return vals[k]; })()) };
  });
  const total = octaves.reduce((a, o) => a + o.amp, 0);
  return (t: number) => {
    let v = 0;
    for (const o of octaves) {
      const x = t / o.wave;
      const k = Math.floor(x);
      const f = x - k;
      const s = f * f * (3 - 2 * f);
      v += o.amp * (o.at(k) * (1 - s) + o.at(k + 1) * s);
    }
    return v / total;
  };
}

const EDGE = 4.5; // how far the edge wanders in and out, in px (the old filter's reach)
const STEP = 2; // px between points along the edge

/** A closed, torn-looking outline just inside a w by h box. */
function tornOutline(w: number, h: number): string {
  if (w < 20 || h < 20) return "";
  const n = noise1(7);
  const along = noise1(13); // a little sideways wander too, as torn paper has
  const pts: string[] = [];
  let t = 0;
  const push = (x: number, y: number, nx: number, ny: number) => {
    const d = 1 + n(t) * EDGE; // about EDGE either side of the box's edge, as the old filter moved it
    const s = along(t) * EDGE * 0.6;
    pts.push(`${(x + nx * d + ny * s).toFixed(1)} ${(y + ny * d - nx * s).toFixed(1)}`);
    t += STEP;
  };
  for (let x = 0; x < w; x += STEP) push(x, 0, 0, 1); // top, left to right
  for (let y = 0; y < h; y += STEP) push(w, y, -1, 0); // right, down
  for (let x = w; x > 0; x -= STEP) push(x, h, 0, -1); // bottom, right to left
  for (let y = h; y > 0; y -= STEP) push(0, y, 1, 0); // left, up
  return `M${pts.join("L")}Z`;
}

export function PaperSheet() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const id = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const outline = useMemo(() => tornOutline(w, h), [w, h]);

  return (
    <svg ref={ref} className="paper-svg" aria-hidden="true" viewBox={`0 0 ${w || 1} ${h || 1}`} preserveAspectRatio="none">
      {outline && (
        <>
          <defs>
            <clipPath id={`${id}-edge`}>
              <path d={outline} />
            </clipPath>
            <radialGradient id={`${id}-age`} cx="50%" cy="46%" r="72%">
              <stop offset="55%" stopColor="rgb(120 80 40)" stopOpacity="0" />
              <stop offset="100%" stopColor="rgb(120 80 40)" stopOpacity="0.2" />
            </radialGradient>
            <pattern id={`${id}-grain`} patternUnits="userSpaceOnUse" width="128" height="128">
              <image href="/paper-grain.png" width="128" height="128" />
            </pattern>
          </defs>
          <path d={outline} style={{ fill: "var(--bg)" }} />
          <g clipPath={`url(#${id}-edge)`}>
            <rect className="paper-age" x="-10" y="-10" width={w + 20} height={h + 20} fill={`url(#${id}-age)`} />
            {/* texture: a fine grain */}
            <rect x="-10" y="-10" width={w + 20} height={h + 20} fill={`url(#${id}-grain)`} />
          </g>
        </>
      )}
    </svg>
  );
}
