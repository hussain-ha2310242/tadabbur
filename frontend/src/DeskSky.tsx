import { CSSProperties, useEffect, useMemo, useState } from "react";

// The desk's living layer, behind the sheet. Two armillary spheres sit on the
// screen edges, each ring turning and breathing in and out of view at its own
// pace. Ink dust settles slowly through the margins. Decoration only: no text.
const FRAC = [0.28, 0.38, 0.5, 0.62]; // ring radius, as a share of the window height
const TILT = [1, 0.42, 1, 0.3]; // 1 = a flat ring; smaller = a ring seen at an angle
const TICKS = [72, 48, 72, 36];
const SPIN = [150, -210, 290, -380]; // seconds per turn; negative turns backwards
const BREATHE = [24, 31, 19, 27]; // seconds per in-and-out breath, per ring
const SHEET_MAX = 1152; // the sheet's max width (max-w-6xl): the margin is what is left either side

function tickPath(rad: number, ry: number, n: number, unit: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const major = i % (n / 4) === 0;
    const len = major ? unit * 1.6 : unit * 0.7;
    const c = Math.cos(a);
    const s = Math.sin(a);
    d += `M${(rad * c).toFixed(2)} ${(ry * s).toFixed(2)}L${((rad + len) * c).toFixed(2)} ${((ry + len * (ry / rad)) * s).toFixed(2)}`;
  }
  return d;
}

function Sphere({ side, height }: { side: "left" | "right"; height: number }) {
  const rings = useMemo(
    () =>
      FRAC.map((f, i) => {
        const rad = height * f;
        const ry = rad * TILT[i];
        return { rx: rad, ry, d: tickPath(rad, ry, TICKS[i], height * 0.012) };
      }),
    [height],
  );

  // the svg is a square whose centre sits on the screen edge, vertically centred
  const R = height * FRAC[FRAC.length - 1];
  const edge: CSSProperties = side === "left" ? { left: -R } : { right: -R };
  const style: CSSProperties = { ...edge, top: height / 2 - R, width: R * 2, height: R * 2 };
  // the right sphere turns and breathes out of step with the left, so the pair is not copied
  const flip = side === "right";

  return (
    <svg className="desk-sky" aria-hidden="true" style={style} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
      {rings.map((r, i) => {
        const backwards = (SPIN[i] < 0) !== flip;
        const phase = BREATHE[i] * (0.37 * (i + 1) + (flip ? 0.5 : 0));
        return (
          <g
            key={i}
            className="desk-breathe"
            style={{ animationDuration: `${BREATHE[i]}s`, animationDelay: `${-phase}s` }}
          >
            <g
              className="desk-spin"
              style={{
                animationDuration: `${Math.abs(SPIN[i])}s`,
                animationDirection: backwards ? "reverse" : "normal",
              }}
            >
              <ellipse cx={0} cy={0} rx={r.rx} ry={r.ry} />
              <path d={r.d} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

type Speck = { x: number; y: number; r: number; o: number; dx: number; dy: number; dur: number; delay: number };

// a small seeded random, so the specks land in the same places on every load
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function specksFor(w: number, h: number): Speck[] {
  const margin = (w - Math.min(w, SHEET_MAX)) / 2;
  if (margin < 24) return []; // a phone: the sheet covers the desk
  const rand = rng(7);
  const count = Math.round((margin * h) / 8000);
  const out: Speck[] = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < count; i++) {
      const x = side === 0 ? rand() * margin : w - margin + rand() * margin;
      const dur = 30 + rand() * 40;
      out.push({
        x,
        y: rand() * h,
        r: 0.6 + rand() * 1.3,
        o: 0.3 + rand() * 0.4,
        dx: (rand() - 0.5) * 28,
        dy: 60 + rand() * 140,
        dur,
        delay: -rand() * dur,
      });
    }
  }
  return out;
}

function Dust({ width, height }: { width: number; height: number }) {
  const specks = useMemo(() => specksFor(width, height), [width, height]);
  return (
    <svg className="desk-dust" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {specks.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          style={
            {
              "--o": s.o,
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              animationDuration: `${s.dur}s`,
              animationDelay: `${s.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}

export function DeskSky() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      <Dust width={size.w} height={size.h} />
      <Sphere side="left" height={size.h} />
      <Sphere side="right" height={size.h} />
    </>
  );
}
