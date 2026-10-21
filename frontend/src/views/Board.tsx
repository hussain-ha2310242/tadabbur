import type { CSSProperties } from "react";
import type { TextSummary } from "../api";
import { Icon } from "../icons";

/** A small seeded random generator: the same note always lands the same way,
 *  so the board looks hand-pinned but does not reshuffle on every visit. */
function seeded(id: number) {
  let a = (id * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a sticky note's own colours, muted to sit on the paper
const PAPERS = ["yellow", "rose", "mint", "sky"] as const;

type Look = {
  paper: (typeof PAPERS)[number];
  rot: number; // degrees
  dx: number; // px
  dy: number; // px
  tapeX: number; // where the tape sits along the top edge, -1..1
  tapeRot: number; // degrees
};

function lookFor(id: number): Look {
  const r = seeded(id);
  return {
    paper: PAPERS[Math.floor(r() * PAPERS.length)],
    rot: (r() * 2 - 1) * 2.4,
    dx: (r() * 2 - 1) * 6,
    dy: (r() * 2 - 1) * 8,
    tapeX: (r() * 2 - 1) * 0.2,
    tapeRot: (r() * 2 - 1) * 5,

  };
}

/** The notes as sticky notes on the sheet. The layout
 *  follows how many notes there are: one centred, two side by side at
 *  different heights, three with the middle one dropped, more in a loose grid. */
export function CorkBoard({
  texts,
  onOpen,
  onDelete,
}: {
  texts: TextSummary[];
  onOpen: (t: TextSummary) => void;
  onDelete: (t: TextSummary) => void;
}) {
  const count = Math.min(texts.length, 4);
  return (
    <ul className="board" data-count={count >= 4 ? "many" : count}>
      {texts.map((t, i) => {
        const look = lookFor(t.id);
        const total = t.words ?? 0;
        const learn = t.to_learn ?? 0;
        const known = Math.max(0, total - learn);
        const pct = total ? Math.round((known / total) * 100) : 0;
        const details = `${pct}% known · ${learn} to learn · ${t.sentences} sentences`;
        return (
          <li
            key={t.id}
            className={`sticky-note paper-${look.paper}`}
            style={
              {
                "--rot": `${look.rot}deg`,
                "--dx": `${look.dx}px`,
                "--dy": `${look.dy}px`,
                "--i": i,
                "--tape-x": look.tapeX,
                "--tape-rot": `${look.tapeRot}deg`,
              } as CSSProperties
            }
          >
            <span className="tape" aria-hidden="true" />
            <button className="sticky-open" onClick={() => onOpen(t)} title={details}>
              <span className="ar sticky-title">{t.title}</span>
              {t.source && (
                <span className="sticky-source hand" dir="auto">
                  {t.source}
                </span>
              )}
              {t.excerpt && (
                <span
                  className="ar sticky-excerpt"
                  dir="rtl"
                  ref={(el) => {
                    if (el) el.classList.toggle("clamped", el.scrollHeight > el.clientHeight + 1);
                  }}
                >
                  {t.excerpt}
                </span>
              )}
            </button>
            <div className="sticky-foot">
              <span className="sticky-bar" role="img" aria-label={details} title={details}>
                <span style={{ width: `${pct}%` }} />
              </span>
              {t.tags.length > 0 && (
                <span className="sticky-tags hand">{t.tags.map((g) => `#${g.name}`).join(" ")}</span>
              )}
            </div>
            <button className="sticky-x" onClick={() => onDelete(t)} title="Delete note" aria-label="Delete note">
              <Icon name="close" size={11} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
