import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

export const LEVELS: { status: string; label: string; key: string }[] = [
  { status: "not_known", label: "Not known", key: "1" },
  { status: "hard", label: "Hard", key: "2" },
  { status: "easy", label: "Easy", key: "3" },
  { status: "known", label: "Known", key: "4" },
];

/** A draggable familiarity control. Drag the thumb or click a stop; the level
 *  is saved when you let go. Two looks:
 *  - "track" (the reader): a thin line with four dots and a thumb.
 *  - "dial" (the review card): a mechanical slide fader. A recessed slot, four
 *    detent notches, and a ridged cap whose stripe takes the level's colour. */
export function StatusSlider({
  value,
  onChange,
  stars = false,
  empty,
  hideCaption = false,
  variant = "track",
}: {
  value: string | undefined;
  onChange: (s: string) => void;
  /** show the level as asterisks (one per level) instead of its name */
  stars?: boolean;
  /** caption when no level is set yet */
  empty?: string;
  /** leave out the caption; the thumb and its colour show the level */
  hideCaption?: boolean;
  variant?: "track" | "dial";
}) {
  const idx = LEVELS.findIndex((l) => l.status === value);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);

  // position from pointer x, in stop indices 0..3 (the thumb is inset by half its
  // width on each side, so the usable track is inset by 6px, or 11px for the knob)
  function indexAt(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const inset = variant === "dial" ? 11 : 6;
    const f = (clientX - r.left - inset) / Math.max(1, r.width - inset * 2);
    return Math.round(Math.min(Math.max(f, 0), 1) * (LEVELS.length - 1));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(indexAt(e.clientX));
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current) setDrag(indexAt(e.clientX));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    const to = indexAt(e.clientX);
    setDrag(null);
    if (to !== idx) onChange(LEVELS[to].status);
  }

  function onPointerCancel() {
    dragging.current = false;
    setDrag(null);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const pos = idx < 0 ? 0 : idx;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // keep the arrow keys for the slider, not for word navigation
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === "ArrowRight" ? Math.min(pos + 1, LEVELS.length - 1) : Math.max(pos - 1, 0);
      onChange(LEVELS[next].status);
    }
  }

  const shown = drag ?? (idx < 0 ? null : idx);
  const pos = shown ?? 0;
  const label = shown === null ? empty ?? "not in your list" : LEVELS[shown].label;
  const caption = shown === null || !stars ? label : "*".repeat(shown + 1);

  const vars = { "--pos": pos, "--c": `var(--st-${pos})` } as CSSProperties;
  const handlers = {
    onKeyDown: onKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };

  if (variant === "dial") {
    return (
      <div className="dial-wrap" style={vars}>
      <div className="dial-row">
        <div
          ref={trackRef}
          className={`dial ${shown !== null ? "set" : ""} ${drag !== null ? "dragging" : ""}`}
          role="slider"
          tabIndex={0}
          aria-label="Familiarity"
          aria-valuemin={0}
          aria-valuemax={LEVELS.length - 1}
          aria-valuenow={shown ?? -1}
          aria-valuetext={label}
          {...handlers}
        >
          <span className="dial-slot" aria-hidden="true" />
          <span className="dial-cap" aria-hidden="true">
            <span key={shown ?? -1} className={`dial-stripe ${shown !== null ? "bloom" : ""}`} />
          </span>
        </div>
        {/* the chosen level's name, in line with the slider */}
        <span className="dial-stars" aria-live="polite">
          {shown === null ? "" : LEVELS[shown].label.toLowerCase()}
        </span>
      </div>
      </div>
    );
  }

  return (
    <div className="slider-wrap" style={vars}>
      <div
        ref={trackRef}
        className={`slider ${shown !== null ? "set" : ""} ${drag !== null ? "dragging" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Familiarity"
        aria-valuemin={0}
        aria-valuemax={LEVELS.length - 1}
        aria-valuenow={shown ?? -1}
        aria-valuetext={label}
        {...handlers}
      >
        {LEVELS.map((l, i) => (
          <span
            key={l.status}
            className={`slider-dot ${i === shown ? "on" : ""}`}
            style={{ "--i": i } as CSSProperties}
            title={`${l.label} (${l.key})`}
          />
        ))}
        <span className="slider-thumb" aria-hidden="true" />
      </div>
      {!hideCaption && <span className="slider-cap">{caption}</span>}
    </div>
  );
}
