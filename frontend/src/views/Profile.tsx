import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { DayActivity, Profile, Streak } from "../api";
import { Icon } from "../icons";

type Stats = {
  known: number;
  learning: number;
  ignored: number;
  phrases: number;
  due: number;
  texts: number;
  streak?: Streak;
  name?: string;
};

/** The eight-pointed star from the title rule. Filled when today already
 *  counts towards the streak, an outline when it still needs study. */
export function StreakStar({ lit, size = 13 }: { lit: boolean; size?: number }) {
  return (
    <svg
      className={`streak-star ${lit ? "lit" : ""}`}
      width={size}
      height={size}
      viewBox="-6.5 -6.5 13 13"
      aria-hidden="true"
    >
      <path d="M0.00 -6.20 L1.11 -2.68 L4.38 -4.38 L2.68 -1.11 L6.20 0.00 L2.68 1.11 L4.38 4.38 L1.11 2.68 L0.00 6.20 L-1.11 2.68 L-4.38 4.38 L-2.68 1.11 L-6.20 0.00 L-2.68 -1.11 L-4.38 -4.38 L-1.11 -2.68 Z" />
    </svg>
  );
}

function streakTitle(s: Streak): string {
  const days = `${s.current}-day streak`;
  return s.today ? `${days}, today counted` : `${days}, study today to keep it`;
}

/** You, in the sheet's top-right corner on every page: the streak star, the
 *  streak and your name. Opens the profile. Refetches when `refresh` changes,
 *  so it is current after a review or a reading session. */
export function ProfileChip({ onOpen, refresh }: { onOpen: () => void; refresh?: unknown }) {
  const [me, setMe] = useState<{ name: string; streak: Streak } | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d: Stats) => d.streak && setMe({ name: d.name || "profile", streak: d.streak }))
      .catch(() => {});
  }, [refresh]);

  if (!me) return null;
  return (
    <button onClick={onOpen} className="me-link me-corner hand" title={streakTitle(me.streak)}>
      <span className="me-streak">
        <StreakStar lit={me.streak.today} />
        <b>{me.streak.current}</b>
      </span>
      <span className="me-name">{me.name}</span>
    </button>
  );
}

/** The home line: one control for the deck and the word wallet, and the
 *  `action` (add a note) at the end. The share known lives in the words
 *  tooltip and on the profile. Shows nothing until the numbers arrive. */
export function HomeStats({
  onReview,
  onWords,
  action,
}: {
  onReview: () => void;
  onWords?: () => void;
  action?: ReactNode;
}) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const tracked = stats.known + stats.learning;
  const pct = tracked === 0 ? 0 : Math.round((stats.known / tracked) * 100);

  return (
    <div className="home-line">
      <span className="deck-merge hand">
        <button onClick={onReview} title="Open the deck: the cards due now">
          deck <b>{stats.due}</b>
        </button>
        {onWords && (
          <>
            <span className="deck-merge-sep" aria-hidden="true">
              ·
            </span>
            <button onClick={onWords} title={`Your words: ${pct}% known, ${stats.learning} learning`}>
              words <b>{tracked}</b>
            </button>
          </>
        )}
      </span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

// ---- the profile page: a name, a streak, the grid, one line of totals ----

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

/** how much was studied that day, as one of five steps (0 = nothing) */
function level(d: DayActivity): number {
  const n = d.reviews + d.marks + d.texts;
  if (n === 0) return 0;
  if (n < 5) return 1;
  if (n < 20) return 2;
  if (n < 50) return 3;
  return 4;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function dayLabel(d: DayActivity): string {
  const date = parseDay(d.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const parts = [
    d.reviews && plural(d.reviews, "review"),
    d.marks && plural(d.marks, "word marked", "words marked"),
    d.texts && plural(d.texts, "note added", "notes added"),
  ].filter(Boolean);
  return `${date}: ${parts.length ? parts.join(", ") : "no study"}`;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Counts from 0 up to `to` once, easing out. Shows the final value at once
 *  for readers who prefer less motion. */
function useCountUp(to: number, ms = 700, delay = 0): number {
  const [n, setN] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setN(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const k = Math.min(1, Math.max(0, (t - start - delay) / ms));
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, delay]);
  return n;
}

/** Twelve weeks of study, one cell per day: weeks run left to right, days
 *  Sunday to Saturday top to bottom, darker for more. Today is the star. */
function ActivityGrid({ days, today, lit }: { days: DayActivity[]; today: string; lit: boolean }) {
  if (days.length === 0) return null;
  const pad = parseDay(days[0].day).getDay(); // Sunday = 0
  const cells: (DayActivity | null)[] = [...Array(pad).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);

  // a month name over the first week of each month; when two would sit closer
  // than three weeks apart, the earlier (partial) month gives way
  const labels: { col: number; text: string }[] = [];
  let prevMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const first = cells.slice(w * 7, w * 7 + 7).find(Boolean);
    if (!first) continue;
    const date = parseDay(first.day);
    if (date.getMonth() !== prevMonth) {
      if (labels.length && w - labels[labels.length - 1].col < 3) labels.pop();
      labels.push({ col: w, text: date.toLocaleDateString("en-GB", { month: "short" }) });
      prevMonth = date.getMonth();
    }
  }

  return (
    <figure className="act" style={{ "--weeks": weeks } as CSSProperties}>
      <div className="act-months" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.col} style={{ gridColumn: l.col + 1 }}>
            {l.text}
          </span>
        ))}
      </div>
      <div className="act-grid" role="list" aria-label="Study over the last 12 weeks">
        {cells.map((d, i) =>
          !d ? (
            <span key={`pad-${i}`} className="act-cell pad" aria-hidden="true" />
          ) : d.day === today ? (
            <span key={d.day} role="listitem" className="act-cell act-today" title={dayLabel(d)} aria-label={dayLabel(d)}>
              <StreakStar lit={lit} size={16} />
            </span>
          ) : (
            <span
              key={d.day}
              role="listitem"
              className={`act-cell l${level(d)}`}
              style={{ "--i": i } as CSSProperties}
              title={dayLabel(d)}
              aria-label={dayLabel(d)}
            />
          ),
        )}
      </div>
    </figure>
  );
}

function joinedLabel(joined: string | null): string | null {
  if (!joined) return null;
  const d = new Date(`${joined.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    api
      .getProfile()
      .then(setP)
      .catch((e) => setError(String(e)));
  }, []);

  // the numbers count up as the grid fills in
  const streakN = useCountUp(p?.streak.current ?? 0, 600, 150);
  const wordsN = useCountUp(p?.totals.words ?? 0, 900, 450);
  const knownN = useCountUp(p?.totals.known ?? 0, 900, 450);
  const learningN = useCountUp(p?.totals.learning ?? 0, 900, 450);

  async function saveName() {
    const name = draft.trim();
    if (!p || !name || name === p.name) {
      setEditing(false);
      return;
    }
    try {
      setP(await api.updateProfile({ name }));
      setEditing(false);
    } catch (e) {
      setError(String(e));
    }
  }

  if (error && !p) return <p className="me-error hand">could not load the profile: {error}</p>;
  if (!p) return null;

  const { streak } = p;
  const since = joinedLabel(p.joined);

  return (
    <section className="pf">
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={saveName}
          className="pf-name-input"
          aria-label="Your name"
        />
      ) : (
        <h2 className="pf-name" title={since ? `studying since ${since}` : undefined}>
          {p.name}
          <button
            onClick={() => {
              setDraft(p.name);
              setEditing(true);
            }}
            className="icon-btn sm"
            aria-label="Edit your name"
            title="Edit your name"
          >
            <Icon name="pencil" size={13} />
          </button>
        </h2>
      )}

      <p
        className="pf-streak hand"
        title={`${streakTitle(streak)}. A day counts when you review a card, set a word's level, or add a note (${p.timezone} time).`}
      >
        <StreakStar lit={streak.today} size={18} />
        <b>{streakN}</b> day streak
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        best {streak.longest}
      </p>

      <ActivityGrid days={p.days} today={p.today} lit={streak.today} />

      <p className="pf-line hand">
        <b>{wordsN}</b> words
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        <b className="known">{knownN}</b> known
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        <b>{learningN}</b> learning
      </p>
      {error && <p className="me-error hand">{error}</p>}
    </section>
  );
}
