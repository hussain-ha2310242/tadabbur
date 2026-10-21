import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Annotation, WalletWord } from "../api";
import { Icon } from "../icons";
import { cleanGloss } from "../gloss";
import { LEVELS, StatusSlider } from "../StatusSlider";

type Sort = "recent" | "az" | "level";

const PAGE = 60;

// Arabic short vowels, shadda, sukun, dagger alif and tatweel: ignored when searching
const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(HARAKAT, "").replace(/[أإآ]/g, "ا").toLowerCase().trim();
}

const ARABIC = /[\u0621-\u064A]/;

const LEVEL_ORDER = Object.fromEntries(LEVELS.map((l, i) => [l.status, i]));

/** The word wallet: every word you have marked, with its meaning, root and
 *  level. Search in Arabic (with or without vowels), English, or by root. */
export default function Words() {
  const [words, setWords] = useState<WalletWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [limit, setLimit] = useState(PAGE);
  // your notes on texts: shown under the "notes" filter, each with its level
  const [notes, setNotes] = useState<Annotation[]>([]);

  useEffect(() => {
    api
      .listWords()
      .then(setWords)
      .catch((e) => setError(String(e)));
    api
      .listNotes()
      .then(setNotes)
      .catch(() => {});
  }, []);

  // a new search or filter starts from the top of the list again
  useEffect(() => setLimit(PAGE), [query, only, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: words?.length ?? 0 };
    for (const w of words ?? []) c[w.status] = (c[w.status] ?? 0) + 1;
    return c;
  }, [words]);

  const shown = useMemo(() => {
    if (!words) return [];
    const q = norm(query);
    const qRoot = q.replace(/\s+/g, "");
    const list = words.filter(
      (w) =>
        (only === "all" || w.status === only) &&
        (!q ||
          norm(w.display).includes(q) ||
          norm(w.lemma_key).includes(q) ||
          norm(cleanGloss(w.gloss)).includes(q) ||
          (qRoot && norm(w.root).replace(/\s+/g, "").includes(qRoot))),
    );
    const recent = (a: WalletWord, b: WalletWord) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (sort === "recent") list.sort(recent);
    else if (sort === "az") list.sort((a, b) => norm(a.display).localeCompare(norm(b.display), "ar"));
    else list.sort((a, b) => (LEVEL_ORDER[a.status] ?? 9) - (LEVEL_ORDER[b.status] ?? 9) || recent(a, b));
    return list;
  }, [words, query, only, sort]);

  const shownNotes = useMemo(() => {
    const q = norm(query);
    return notes.filter(
      (n) =>
        !q ||
        norm(n.quote).includes(q) ||
        norm(n.meaning).includes(q) ||
        norm(n.comment).includes(q) ||
        norm(n.title).includes(q),
    );
  }, [notes, query]);

  async function setNoteLevel(n: Annotation, status: string) {
    const before = n.status;
    setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, status } : x)));
    try {
      await api.updateNote(n.id, { status });
    } catch (e) {
      setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, status: before } : x)));
      setError(String(e));
    }
  }

  async function setLevel(w: WalletWord, status: string) {
    const before = w.status;
    setWords((ws) => ws?.map((x) => (x.lemma_key === w.lemma_key ? { ...x, status } : x)) ?? ws);
    try {
      await api.updateVocab(w.lemma_key, { status });
    } catch (e) {
      setWords((ws) => ws?.map((x) => (x.lemma_key === w.lemma_key ? { ...x, status: before } : x)) ?? ws);
      setError(String(e));
    }
  }

  if (error && !words) return <p className="me-error hand">could not load your words: {error}</p>;
  if (!words) return null;

  return (
    <section className="wallet mx-auto max-w-3xl">
      <header className="wallet-head">
        <h2 className="me-title">my words</h2>
        <span className="wallet-count hand">{words.length}</span>
      </header>

      <div className="wallet-tools">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search: كتب, book, or a root"
          className="wallet-search"
          aria-label="Search your words"
        />
        <div className="wallet-filters hand" role="group" aria-label="Show level">
          {[{ status: "all", label: "all" }, ...LEVELS].map((l) => (
            <button
              key={l.status}
              onClick={() => setOnly(l.status)}
              aria-pressed={only === l.status}
              className={`wallet-chip ${only === l.status ? "on" : ""}`}
              style={l.status === "all" ? undefined : { ["--c" as string]: `var(--st-${LEVEL_ORDER[l.status]})` }}
            >
              {l.status !== "all" && <i aria-hidden="true" />}
              {l.label.toLowerCase()} <b>{counts[l.status] ?? 0}</b>
            </button>
          ))}
          <button
            onClick={() => setOnly("notes")}
            aria-pressed={only === "notes"}
            className={`wallet-chip ${only === "notes" ? "on" : ""}`}
            title="Phrases and notes you selected while reading"
          >
            <Icon name="pencil" size={11} />
            phrases &amp; notes <b>{notes.length}</b>
          </button>
        </div>
        <label className="wallet-sort hand">
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">newest</option>
            <option value="az">a to z</option>
            <option value="level">level</option>
          </select>
        </label>
      </div>

      {error && <p className="me-error hand">{error}</p>}

      {only === "notes" ? (
        shownNotes.length === 0 ? (
          <p className="wallet-empty hand">
            {query ? "nothing matches that search" : "nothing yet: drag across words while reading to save a phrase or a note"}
          </p>
        ) : (
          <ul className="wallet-list">
            {shownNotes.map((n) => (
              <li key={n.id} className="wallet-row wallet-note">
                <span className="wallet-ar ar wallet-note-quote" dir="rtl" title={n.quote}>
                  {n.quote}
                </span>
                <span className="wallet-meaning">
                  <span className="wallet-gloss hand" dir="auto">
                    {n.meaning || "-"}
                  </span>
                  {n.comment && (
                    <span className="wallet-comment hand" dir="auto">
                      {n.comment}
                    </span>
                  )}
                  {n.title && <span className="wallet-from hand">{n.title}</span>}
                </span>
                <span className="wallet-level">
                  <StatusSlider value={n.status} onChange={(st) => setNoteLevel(n, st)} hideCaption />
                  <span className="wallet-level-name hand" style={{ color: `var(--st-${LEVEL_ORDER[n.status] ?? 0})` }}>
                    {LEVELS[LEVEL_ORDER[n.status] ?? 0]?.label.toLowerCase()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : shown.length === 0 ? (
        <p className="wallet-empty hand">{query ? "no word matches that search" : "no words at this level yet"}</p>
      ) : (
        <ul className="wallet-list">
          {shown.slice(0, limit).map((w) => (
            <li key={w.lemma_key} className="wallet-row">
              <span className="wallet-ar ar" dir="rtl">
                {w.display}
                {!!w.is_phrase && <em className="wallet-tag hand">phrase</em>}
              </span>
              <span className="wallet-meaning">
                <span className="wallet-gloss hand">{cleanGloss(w.gloss)}</span>
                {w.root && ARABIC.test(w.root) && (
                  <span className="wallet-root ar" dir="rtl" title="root">
                    {w.root}
                  </span>
                )}
              </span>
              <span className="wallet-level">
                <StatusSlider value={w.status} onChange={(s) => setLevel(w, s)} hideCaption />
                <span className="wallet-level-name hand" style={{ color: `var(--st-${LEVEL_ORDER[w.status] ?? 0})` }}>
                  {LEVELS[LEVEL_ORDER[w.status] ?? 0]?.label.toLowerCase()}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {only !== "notes" && shown.length > limit && (
        <button onClick={() => setLimit((n) => n + PAGE)} className="wallet-more hand">
          show more ({shown.length - limit} left)
        </button>
      )}
    </section>
  );
}
