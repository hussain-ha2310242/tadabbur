import { useEffect, useLayoutEffect, useState } from "react";

/** One step: what to point at, and what to say. A step whose `until` element
 *  appears moves on by itself (e.g. "open the article"). */
export type Step = { at: string; title: string; text: string; until?: string };

export const READER_TOUR: Step[] = [
  {
    at: ".sticky-note",
    title: "Your articles",
    text: "Each article you add sits here as a note. Open this one to start.",
    until: ".note-title",
  },
  {
    at: ".tile-sentence, .sent-card.sent-live",
    title: "Tap any word",
    text: "Tap a word (or move with ← →) to see its meaning, dictionary form and root.",
  },
  {
    at: ".wp",
    title: "Mark what you know",
    text: "Slide the dot, or press 1 to 4, from not known to known. The words you mark come back in your deck.",
  },
  {
    at: ".tile-sentence, .sent-card.sent-live",
    title: "Keep a phrase",
    text: "Drag across a few words, type a note if you like, and press Enter. The phrase stays underlined.",
  },
  {
    at: ".note-track",
    title: "Your progress",
    text: "How much of this text you know. The button beside it opens its flashcards.",
  },
];

type Box = { top: number; left: number; width: number; height: number };

function boxOf(sel: string): Box | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** A short guided tour: a soft spotlight on one part of the page and a card
 *  that says what it does. Skip at any time; Esc skips too. */
export function Tour({ steps, onDone }: { steps: Step[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps[i];

  // follow the element as the page moves, and move on when `until` shows up
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      if (step.until && document.querySelector(step.until)) {
        setI((n) => Math.min(n + 1, steps.length - 1));
        return;
      }
      const b = boxOf(step.at);
      setBox((old) =>
        old && b && Math.abs(old.top - b.top) < 1 && Math.abs(old.left - b.left) < 1 && Math.abs(old.width - b.width) < 1 && Math.abs(old.height - b.height) < 1
          ? old
          : b,
      );
      raf = requestAnimationFrame(tick);
    };
    const el = document.querySelector(step.at);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const last = i === steps.length - 1;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(320, vw - 24);
  // the card sits under the spotlight, or above it when there is no room below
  let top = vh / 2 - 80;
  let left = vw / 2 - cardW / 2;
  if (box) {
    const below = box.top + box.height + pad + 12;
    top = below + 170 < vh ? below : Math.max(12, box.top - pad - 12 - 170);
    left = Math.min(Math.max(12, box.left + box.width / 2 - cardW / 2), vw - cardW - 12);
  }

  return (
    <div className="tour" role="dialog" aria-label="Guided tour" dir="ltr">
      {box ? (
        <div
          className="tour-spot"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div key={i} className="tour-card sticky" style={{ top, left, width: cardW }}>
        <div className="tour-head">
          <b className="hand">{step.title}</b>
          <span className="tour-count">
            {i + 1}/{steps.length}
          </span>
        </div>
        <p className="tour-text">{step.text}</p>
        <div className="tour-foot">
          <button className="tour-skip hand" onClick={onDone}>
            {last ? "close" : "skip the tour"}
          </button>
          <span className="tour-nav">
            {i > 0 && !steps[i - 1].until && (
              <button className="tour-back hand" onClick={() => setI(i - 1)}>
                back
              </button>
            )}
            {!step.until && (
              <button className="tour-next hand" onClick={() => (last ? onDone() : setI(i + 1))}>
                {last ? "done" : "next"}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
