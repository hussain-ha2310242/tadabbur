import { useEffect, useRef, useState } from "react";
import { api, DueWord, TagWithCount, TextSummary } from "../api";
import { cleanGloss } from "../gloss";
import { StatusSlider } from "../StatusSlider";

const STATUSES = ["not_known", "hard", "easy", "known"];

const stars = (n: number | undefined) => "*".repeat(Math.max(1, n ?? 0));

const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

// what the queue is filtered by. Each list is multi-select; an empty list means
// no filter on that field. scopes hold "tag:<id>" or "text:<id>".
type Filters = { scopes: string[]; statuses: string[]; levels: number[] };
const ALL: Filters = { scopes: [], statuses: [], levels: [] };

const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// the filter panel: latin face, larger and darker than the card's notes
const panelLink = (on: boolean) =>
  `flex items-baseline gap-1.5 text-left text-[13px] transition-colors ${on ? "text-[var(--ink-red)] font-semibold" : "text-[var(--fg)] hover:text-[var(--ink-red)]"}`;
// the compact chips for difficulty: one row, smaller text
const chipLink = (on: boolean) =>
  `flex items-baseline gap-1 whitespace-nowrap text-left text-[12px] transition-colors ${on ? "text-[var(--ink-red)] font-semibold" : "text-[var(--fg)] hover:text-[var(--ink-red)]"}`;
const panelLabel = "mt-3 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider opacity-60";
// [x] and [ ] read like a terminal's checkboxes
const box = (on: boolean) => (
  <span style={{ fontFamily: MONO, fontWeight: 400, opacity: on ? 1 : 0.5 }}>{on ? "[x]" : "[ ]"}</span>
);

const link = (on: boolean) =>
  `hand text-sm transition-colors ${on ? "text-[var(--ink-red)] underline underline-offset-4" : "text-[var(--muted)] hover:text-[var(--fg)]"}`;

/** The deck. With `textId`, it opens on that note's cards only; the filter
 *  panel shows the note selected, so the scope can still be widened. */
export default function Review({ textId }: { textId?: number } = {}) {
  const start: Filters = textId ? { ...ALL, scopes: [`text:${textId}`] } : ALL;
  const [queue, setQueue] = useState<DueWord[]>([]);
  const [picked, setPicked] = useState<string | null>(null); // the level chosen for this card
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(0); // bumps per card: flips direction and replays the entrance
  const [applied, setApplied] = useState<Filters>(start); // what the queue is showing
  const [draft, setDraft] = useState<Filters>(start); // what the panel is set to
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [notes, setNotes] = useState<TextSummary[]>([]);
  const [showAllSources, setShowAllSources] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // choosing a level reveals the meaning; the level is saved on next
  const revealed = picked !== null;

  useEffect(() => {
    api.listTags().then(setTags).catch(() => {});
    api.listTexts().then(setNotes).catch(() => {});
    load(start, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close the panel on a click outside it
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // fetch the due words for the chosen sources (one request), keep those that
  // match the difficulty and importance filters, and shuffle when asked
  async function load(f: Filters, shuffle: boolean) {
    setLoading(true);
    setError(null);
    setPicked(null);
    const tagIds = f.scopes.filter((k) => k.startsWith("tag:")).map((k) => Number(k.slice(4)));
    const textIds = f.scopes.filter((k) => k.startsWith("text:")).map((k) => Number(k.slice(5)));
    try {
      const words = await api.dueWords({ tagIds, textIds });
      const kept = words.filter(
        (w) =>
          (f.statuses.length === 0 || f.statuses.includes(w.status)) &&
          (f.levels.length === 0 || f.levels.includes(Math.max(1, w.importance ?? 1))),
      );
      setQueue(shuffle ? shuffled(kept) : kept);
      setDone(0);
      setApplied(f);
      setSeed((s) => s + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const current = queue[0];

  // English to Arabic and Arabic to English take turns, so both get tested.
  // The English front needs a gloss to show.
  // A note's card always shows the selection first and your comment behind it.
  const isNote = current?.kind === "note";
  const enFront = !isNote && !!current?.gloss && seed % 2 === 0;

  // step 1: pick a level, which reveals the meaning
  function choose(status: string) {
    if (!current) return;
    setError(null);
    setPicked(status);
  }

  // step 2: save the chosen level and move on
  async function next() {
    if (!current || picked === null) return;
    setError(null);
    try {
      await api.grade(current.lemma_key, picked);
      setQueue(picked === "not_known" ? [...queue.slice(1), current] : queue.slice(1));
      if (picked !== "not_known") setDone((d) => d + 1);
      setPicked(null);
      setSeed((s) => s + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  // same rule as the reader: one star, then two, three, and back to one
  async function cycleImportance() {
    if (!current) return;
    const cur = Math.max(1, current.importance ?? 0);
    const next = (cur % 3) + 1;
    setQueue((q) => q.map((w, i) => (i === 0 ? { ...w, importance: next } : w)));
    try {
      await api.updateVocab(current.lemma_key, { importance: next });
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        if (revealed) next();
      } else if (e.key === "i") cycleImportance();
      else if (["1", "2", "3", "4"].includes(e.key)) {
        choose(STATUSES[parseInt(e.key) - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeCount =
    (applied.scopes.length ? 1 : 0) + (applied.statuses.length ? 1 : 0) + (applied.levels.length ? 1 : 0);

  const total = done + queue.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const status = loading
    ? ""
    : current
      ? `${queue.length} to go${done ? ` · ${done} done` : ""}`
      : done > 0
        ? `${done} ${done === 1 ? "card" : "cards"} done, well done`
        : activeCount
          ? "nothing matches these filters"
          : "nothing due right now";

  // every source the panel can pick: tags, then notes
  const sources = [
    ...tags.map((t) => ({ key: `tag:${t.id}`, label: `#${t.name}`, count: t.notes, ar: false })),
    ...notes.map((n) => ({ key: `text:${n.id}`, label: n.title, count: undefined, ar: true })),
  ];
  const sourceSummary = draft.scopes.length ? `${draft.scopes.length} selected` : "everything";

  const header = (
    <>
      <div className="relative mb-5 flex items-baseline justify-between gap-4" ref={panelRef}>
        <p className="hand text-sm" style={{ color: "var(--muted)" }}>{status}</p>
        <button
          onClick={() => {
            setDraft(applied);
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          className={link(activeCount > 0)}
        >
          filter{activeCount ? ` · ${activeCount}` : ""} {open ? "▴" : "▾"}
        </button>

        {/* floats over the page, so opening it never pushes the card down */}
        {open && (
          <div
            className="absolute right-0 top-full z-20 mt-2 w-72 rounded-sm p-4"
            style={{
              background: "var(--bg)",
              boxShadow: "0 12px 28px -14px var(--shadow)",
              border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
              fontFamily: "var(--font-latin)",
            }}
          >
            <div className={panelLabel} style={{ color: "var(--fg)" }}>
              <span>from</span>
              <span className="normal-case tracking-normal font-normal opacity-80">{sourceSummary}</span>
            </div>
            {/* a short scrolling list, so many tags and notes stay compact */}
            <div className="mt-1.5 flex flex-col gap-1 overflow-y-auto pr-1" style={{ maxHeight: "8rem" }}>
              {sources.length === 0 && (
                <span className="text-sm opacity-60">no tags or notes yet</span>
              )}
              {(showAllSources ? sources : sources.slice(0, 5)).map((s) => {
                const on = draft.scopes.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => setDraft({ ...draft, scopes: toggle(draft.scopes, s.key) })}
                    className={`${panelLink(on)} ${s.ar ? "ar text-base" : ""}`}
                  >
                    {box(on)}
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.count != null && <span className="text-xs opacity-50">{s.count}</span>}
                  </button>
                );
              })}
            </div>
            {sources.length > 5 && (
              <button
                onClick={() => setShowAllSources((v) => !v)}
                className="mt-1 text-left text-[11px] underline underline-offset-2 opacity-70"
                style={{ color: "var(--fg)" }}
              >
                {showAllSources ? "show less" : `show ${sources.length - 5} more`}
              </button>
            )}

            <div className={panelLabel} style={{ color: "var(--fg)" }}>
              <span>difficulty</span>
            </div>
            <div className="mt-1 flex flex-nowrap items-center gap-x-3">
              {[
                { key: "not_known", label: "not known" },
                { key: "hard", label: "hard" },
                { key: "easy", label: "easy" },
              ].map((d) => {
                const on = draft.statuses.includes(d.key);
                return (
                  <button
                    key={d.key}
                    onClick={() => setDraft({ ...draft, statuses: toggle(draft.statuses, d.key) })}
                    className={chipLink(on)}
                  >
                    {box(on)}
                    <span>{d.label}</span>
                  </button>
                );
              })}
            </div>

            <div className={panelLabel} style={{ color: "var(--fg)" }}>
              <span>importance</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {[1, 2, 3].map((lv) => {
                const on = draft.levels.includes(lv);
                return (
                  <button
                    key={lv}
                    onClick={() => setDraft({ ...draft, levels: toggle(draft.levels, lv) })}
                    className={panelLink(on)}
                    aria-label={`importance ${lv}`}
                  >
                    {box(on)}
                    <span>{"*".repeat(lv)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button onClick={() => setDraft(ALL)} className={panelLink(false)}>
                clear
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  load(draft, true);
                }}
                className="text-[13px] font-semibold underline underline-offset-4"
                style={{ color: "var(--ink-red)" }}
              >
                reshuffle
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (loading) return <div className="mx-auto max-w-xl">{header}</div>;

  if (!current) {
    return (
      <div className="mx-auto max-w-xl">
        {header}
        <div className="sticky review-card" style={{ transform: "rotate(-0.8deg)" }}>
          <p className="hand text-center text-2xl">
            {done > 0 ? "the desk is clear" : activeCount ? "nothing matches" : "nothing due"}
          </p>
          <p className="hand mt-2 text-center text-base" style={{ color: "var(--sticky-muted)" }}>
            {done > 0
              ? `${done} ${done === 1 ? "card" : "cards"} reviewed. come back later.`
              : activeCount
                ? "try another filter, or clear it."
                : "every word in this scope is on schedule."}
          </p>
        </div>
      </div>
    );
  }

  const front = enFront ? cleanGloss(current.gloss) : current.display;
  // a selection's back: its meaning, then your note exactly as written
  const back = isNote ? current.gloss || "" : enFront ? current.display : cleanGloss(current.gloss);
  // a few words either side of the selection, so it is read in its sentence
  const lead = (current.before ?? "").split(" ").filter(Boolean).slice(-6).join(" ");
  const tail = (current.after ?? "").split(" ").filter(Boolean).slice(0, 6).join(" ");
  const roots = (current.root ?? "").split(" ").filter(Boolean);

  return (
    <div className="mx-auto max-w-xl">
      {header}

      {total > 0 && (
        <div className="progress mt-5" role="img" aria-label={`${pct}% of this round done`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--ink-red)", fontFamily: "var(--font-latin)" }} dir="ltr">
          {error}
        </p>
      )}

      <div
        key={`${current.lemma_key}-${seed}`}
        className="sticky review-card card-enter"
        style={{ transform: "rotate(-0.8deg)" }}
      >
        <div className="review-meta">
          <span className="hand text-sm" style={{ color: "var(--sticky-muted)" }}>
            {isNote ? (current.comment ? "note" : "phrase") : enFront ? "en → ar" : "ar → en"}
          </span>
          {!isNote && (
            <button
              onClick={cycleImportance}
              title="Importance (i)"
              aria-label="Cycle importance"
              className={`wp-imp ${(current.importance ?? 0) > 0 ? "on" : ""}`}
            >
              {stars(current.importance)}
            </button>
          )}
        </div>

        <div className="review-front">
          {isNote ? (
            <div className="ar review-note-front" dir="rtl">
              {lead && <span className="review-note-ctx">…{lead} </span>}
              <mark>{current.display}</mark>
              {tail && <span className="review-note-ctx"> {tail}…</span>}
            </div>
          ) : enFront ? (
            <div className="hand text-4xl leading-tight">{front}</div>
          ) : (
            <div className="ar text-5xl leading-relaxed" style={{ color: "var(--sticky-ink)" }}>
              {front}
            </div>
          )}
        </div>

        {revealed && (
          <div className="review-back">
            {isNote ? (
              <>
                {back && <div className="hand review-note-back" dir="auto">{back}</div>}
                {current.comment && <p className="hand review-note-comment" dir="auto">{current.comment}</p>}
                {!back && !current.comment && <div className="hand review-note-back">-</div>}
              </>
            ) : enFront ? (
              <div className="ar text-3xl leading-relaxed">{back ?? "-"}</div>
            ) : (
              <div className="hand text-3xl leading-tight">{back ?? "-"}</div>
            )}
            {roots.length > 0 && (
              <div className="flex gap-1" dir="rtl">
                {roots.map((r, i) => (
                  <span key={i} className="root-l ar">{r}</span>
                ))}
              </div>
            )}
            {current.notes && (
              <p className="hand text-base" style={{ color: "var(--sticky-muted)" }}>
                {current.notes}
              </p>
            )}
          </div>
        )}

        <div className="review-foot">
          <StatusSlider variant="dial" value={picked ?? undefined} onChange={choose} />
          <button
            onClick={next}
            className="review-next"
            title="Next (space)"
            tabIndex={revealed ? 0 : -1}
            style={{ visibility: revealed ? "visible" : "hidden" }}
          >
            next <kbd>space</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
