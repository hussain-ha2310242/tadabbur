import { useState } from "react";

const STAR = "M12 3.6l2.55 5.2 5.7.82-4.13 4.03.98 5.68L12 16.65l-5.1 2.68.98-5.68L3.75 9.62l5.7-.82Z";

/** How important a word or phrase is: three stars. Press a star to set that
 *  many; press the last lit star again to clear them. The star you light pops. */
export function Stars({
  value,
  onChange,
  size = 15,
  title = "Importance (i)",
}: {
  value: number;
  onChange: (n: number) => void;
  size?: number;
  title?: string;
}) {
  const [pop, setPop] = useState<{ n: number; k: number } | null>(null);
  return (
    <span className="stars" role="group" aria-label={`Importance: ${value} of 3`} title={title}>
      {[1, 2, 3].map((n) => {
        const on = n <= value;
        return (
          <button
            key={n}
            type="button"
            className={`star ${on ? "on" : ""}`}
            aria-label={value === n ? "Clear the stars" : `${n} ${n === 1 ? "star" : "stars"}`}
            aria-pressed={on}
            onClick={(e) => {
              e.stopPropagation();
              const next = value === n ? 0 : n;
              if (next > value) setPop({ n: next, k: (pop?.k ?? 0) + 1 });
              onChange(next);
            }}
          >
            <svg
              key={pop && n === pop.n ? pop.k : 0}
              className={pop && on && n === pop.n ? "star-pop" : undefined}
              width={size}
              height={size}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d={STAR} />
            </svg>
          </button>
        );
      })}
    </span>
  );
}

/** The keyboard's 'i': no stars, one, two, three, and round again. */
export const nextStars = (n: number) => (Math.max(0, n) + 1) % 4;
