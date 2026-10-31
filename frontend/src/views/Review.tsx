import { useEffect, useMemo, useRef, useState } from "react";
import { api, shared, type Answer, type DueWord, type TagWithCount, type TextSummary } from "../api";
import { cleanGloss } from "../gloss";
import { Icon } from "../icons";
import { SpeakButton, speak } from "../Speak";
import { nextStars, Stars } from "../Stars";
import { usePhone } from "../usePhone";
import { createPortal } from "react-dom";

/** Anki's answers, in order, with their keys. */
const ANSWERS: { a: Answer; label: string; key: string }[] = [
  { a: "again", label: "Again", key: "1" },
  { a: "hard", label: "Hard", key: "2" },
  { a: "good", label: "Good", key: "3" },
  { a: "easy", label: "Easy", key: "4" },
];

/** The deck's keys, for the shortcuts card. */
const KEYS: [string, string][] = [
  ["space", "show the answer, then good"],
  ["1 2 3 4", "again, hard, good, easy"],
  ["i", "importance * ** ***"],
  ["h", "hear the word"],
  ["?", "show or hide these keys"],
];

/** A card answered with a step shorter than this comes back in the same
 *  session, as in Anki (its "learn ahead" limit). */
const LEARN_AHEAD = 20 * 60 * 1000;

const dueAt = (c: DueWord) => (c.due ? Date.parse(c.due) : 0);

/** The next card: a learning card whose step is up, else the next in the
 *  queue, else the learning card due soonest (Anki shows it early rather than
 *  leave you waiting). Returns the card and what is left. */
function advance(queue: DueWord[], learning: DueWord[]): [DueWord | null, DueWord[], DueWord[]] {
  const now = Date.now();
  const byDue = [...learning].sort((x, y) => dueAt(x) - dueAt(y));
  const ready = byDue.find((c) => dueAt(c) <= now);
  if (ready) return [ready, queue, learning.filter((c) => c !== ready)];
  if (queue.length) return [queue[0], queue.slice(1), learning];
  if (byDue.length) return [byDue[0], queue, learning.filter((c) => c !== byDue[0])];
  return [null, queue, learning];
}

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

/** The deck, the Anki way: the front, then "show answer", then again, hard,
 *  good or easy, each with how long until the card comes back. Cards on a
 *  short step (again, and new cards) come back in the same session. With
 *  `textId`, it opens on that note's cards only; the filter panel shows the
 *  note selected, so the scope can still be widened. */
export default function Review({ textId }: { textId?: number } = {}) {
  const start: Filters = textId ? { ...ALL, scopes: [`text:${textId}`] } : ALL;
  const [queue, setQueue] = useState<DueWord[]>([]); // still to see
  const [learning, setLearning] = useState<DueWord[]>([]); // answered, back in a few minutes
  const [current, setCurrent] = useState<DueWord | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(0); // bumps per card: flips direction and replays the entrance
  const [stamp, setStamp] = useState<{ a: Answer; label: string; k: number } | null>(null);
  const [applied, setApplied] = useState<Filters>(start); // what the queue is showing
  const [draft, setDraft] = useState<Filters>(start); // what the panel is set to
  const [open, setOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [notes, setNotes] = useState<TextSummary[]>([]);
  const [showAllSources, setShowAllSources] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // on a phone the answers sit at the bottom of the screen, under the thumb
  const phone = usePhone();

  useEffect(() => {
    api.listTags().then(setTags).catch(() => {});
    api.listTexts().then(setNotes).catch(() => {});
    load(start, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close the panel and the keys card on a click outside them
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowKeys(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // fetch the due cards for the chosen sources (one request), keep those that
  // match the difficulty and importance filters, and shuffle when asked
  async function load(f: Filters, shuffle: boolean) {
    setLoading(true);
    setError(null);
    setRevealed(false);
    const tagIds = f.scopes.filter((k) => k.startsWith("tag:")).map((k) => Number(k.slice(4)));
    const textIds = f.scopes.filter((k) => k.startsWith("text:")).map((k) => Number(k.slice(5)));
    try {
      const words = await api.dueWords({ tagIds, textIds });
      const kept = words.filter(
        (w) =>
          (f.statuses.length === 0 || f.statuses.includes(w.status)) &&
          (f.levels.length === 0 || f.levels.includes(Math.max(1, w.importance ?? 1))),
      );
      const [first, rest] = advance(shuffle ? shuffled(kept) : kept, []);
      setCurrent(first);
      setQueue(rest);
      setLearning([]);
      setDone(0);
      setApplied(f);
      setSeed((s) => s + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // English to Arabic and Arabic to English take turns, so both get tested.
  // The English front needs a gloss to show.
  // A note's card always shows the selection first and your comment behind it.
  const isNote = current?.kind === "note";
  const enFront = !isNote && !!current?.gloss && seed % 2 === 0;

  // what each answer would do, worked out when the answer is shown
  const outcomes = useMemo(
    () => (current && revealed ? shared.preview(current.card_json) : null),
    [current, revealed],
  );

  function reveal() {
    if (current && !revealed) setRevealed(true);
  }

  // save the answer in the background and go straight on to the next card
  function answer(a: Answer) {
    if (!current || !outcomes) return;
    setError(null);
    const out = outcomes[a];
    const back = { ...current, card_json: out.card_json, due: out.due, status: out.status };
    const soon = Date.parse(out.due) - Date.now() < LEARN_AHEAD;
    if (!soon) setDone((d) => d + 1);
    const [next, q, l] = advance(queue, soon ? [...learning, back] : learning);
    setCurrent(next);
    setQueue(q);
    setLearning(l);
    setRevealed(false);
    setSeed((s) => s + 1);
    setStamp({ a, label: out.label, k: (stamp?.k ?? 0) + 1 });
    api.grade(current.lemma_key, a, out).catch((e) => setError(`not saved: ${String(e)}`));
  }

  // stars on the card: a word's in the wallet, a note's on the note
  async function setImportance(n: number) {
    if (!current) return;
    const key = current.lemma_key;
    setCurrent({ ...current, importance: n });
    try {
      if (current.kind === "note") await api.updateNote(Number(key.slice(shared.NOTE_PREFIX.length)), { importance: n });
      else await api.updateVocab(key, { importance: n });
    } catch (e) {
      setError(String(e));
    }
  }

  const sayIt = () =>
    current && speak(current.display).catch((e) => setError(String(e instanceof Error ? e.message : e)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (revealed) answer("good");
        else reveal();
      } else if (e.key === "i") setImportance(nextStars(current?.importance ?? 0));
      else if (e.key === "h") sayIt();
      else if (e.key === "?") setShowKeys((v) => !v);
      else if (e.key === "Escape") setShowKeys(false);
      else if (revealed && ["1", "2", "3", "4"].includes(e.key)) answer(ANSWERS[Number(e.key) - 1].a);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeCount =
    (applied.scopes.length ? 1 : 0) + (applied.statuses.length ? 1 : 0) + (applied.levels.length ? 1 : 0);

  // Anki's three counts over what is left: new, learning, review
  const left = [...(current ? [current] : []), ...queue, ...learning];
  const kinds = { new: 0, learning: 0, review: 0 };
  for (const c of left) kinds[shared.cardKind(c.card_json)] += 1;
  const curKind = current ? shared.cardKind(current.card_json) : null;

  const total = done + left.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const status = loading
    ? ""
    : current
      ? ""
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

  const counts = current && (
    <p className="deck-counts hand" title="new · learning · to review">
      <span className={`dc dc-new ${curKind === "new" ? "cur" : ""}`}>{kinds.new}</span>
      <span className="dc-sep">·</span>
      <span className={`dc dc-learn ${curKind === "learning" ? "cur" : ""}`}>{kinds.learning}</span>
      <span className="dc-sep">·</span>
      <span className={`dc dc-review ${curKind === "review" ? "cur" : ""}`}>{kinds.review}</span>
      {done > 0 && <span className="dc-done">{done} done</span>}
    </p>
  );

  const header = (
    <>
      <div className="relative mb-5 flex items-baseline justify-between gap-4" ref={panelRef}>
        {counts || <p className="hand text-sm" style={{ color: "var(--muted)" }}>{status}</p>}
        <span className="deck-head-tools">
          <button
            onClick={() => {
              setShowKeys((v) => !v);
              setOpen(false);
            }}
            aria-expanded={showKeys}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className={`keys-btn ${showKeys ? "on" : ""}`}
          >
            <Icon name="keys" size={17} />
          </button>
          <button
            onClick={() => {
              setDraft(applied);
              setOpen((o) => !o);
              setShowKeys(false);
            }}
            aria-expanded={open}
            className={link(activeCount > 0)}
          >
            filter{activeCount ? ` · ${activeCount}` : ""} {open ? "▴" : "▾"}
          </button>
        </span>

        {showKeys && (
          <div className="keys-pop" role="dialog" aria-label="Keyboard shortcuts">
            {KEYS.map(([k, what]) => (
              <div key={k} className="keys-row">
                <span className="keys-k">
                  {k.split(" ").map((x) => (
                    <kbd key={x}>{x}</kbd>
                  ))}
                </span>
                <span className="keys-what">{what}</span>
              </div>
            ))}
          </div>
        )}

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
  // the Arabic can be heard once it is on show: on the front, or behind an English front
  const canHear = !enFront || revealed;

  const foot =
    revealed && outcomes ? (
      <div className="answers" role="group" aria-label="How well did you know it?">
        {ANSWERS.map(({ a, label, key }) => (
          <button key={a} onClick={() => answer(a)} className={`ans ans-${a}`} title={`${label} (${key}${a === "good" ? " or space" : ""})`}>
            <span className="ans-when">{outcomes[a].label}</span>
            <span className="ans-label">{label}</span>
          </button>
        ))}
      </div>
    ) : (
      <button onClick={reveal} className="show-answer">
        show answer <kbd>space</kbd>
      </button>
    );

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

      <div className="review-stage">
        {stamp && (
          <span key={stamp.k} className={`review-stamp ans-${stamp.a}`} aria-hidden="true">
            {stamp.a} · {stamp.label}
          </span>
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
            <span className="review-tools">
              {canHear && <SpeakButton text={current.display} onError={setError} />}
              <Stars value={current.importance ?? 0} onChange={setImportance} />
            </span>
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

          {!phone && <div className="review-foot">{foot}</div>}
        </div>
      </div>
      {phone && createPortal(<div className="phone-dock deck-dock" dir="ltr">{foot}</div>, document.body)}
    </div>
  );
}
