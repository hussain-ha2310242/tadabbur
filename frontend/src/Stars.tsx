import { useState } from "react";

/** How important a word or phrase is, as asterisks: * ** ***. Each press adds
 *  one, and after three it goes back to none (shown as one faint *). The new
 *  asterisks pop in. */
export function Stars({
  value,
  onChange,
  size = 16,
  title = "Importance (i): * ** ***",
}: {
  value: number;
  onChange: (n: number) => void;
  size?: number;
  title?: string;
}) {
  const [pop, setPop] = useState(0);
  const n = Math.max(0, Math.min(3, value || 0));
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setPop((k) => k + 1);
        onChange(nextStars(n));
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={title}
      aria-label={n ? `Importance: ${n} of 3. Press for ${nextStars(n) || "none"}` : "Importance: none. Press for one"}
      className={`wp-imp ${n > 0 ? "on" : ""}`}
      style={{ fontSize: size }}
    >
      <span key={pop} className={pop ? "imp-pop" : undefined}>
        {"*".repeat(Math.max(1, n))}
      </span>
    </button>
  );
}

/** The next importance: none, one, two, three, and round again. */
export const nextStars = (n: number) => (Math.max(0, n) + 1) % 4;
