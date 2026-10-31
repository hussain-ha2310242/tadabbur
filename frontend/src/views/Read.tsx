import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HomeStats } from "./Profile";
import { CorkBoard } from "./Board";
import { api, Sentence, Tag, TextDetail, TextSummary, Token, WordInfo } from "../api";
import type { Annotation } from "../api";
import { analysisKey } from "../study";
import { cleanGloss } from "../gloss";
import { Icon } from "../icons";
import { StatusSlider } from "../StatusSlider";
import { SpeakButton, speak } from "../Speak";
import { nextStars, Stars } from "../Stars";
import { applyTextScale } from "../theme";
import { usePhone } from "../usePhone";
import { createPortal } from "react-dom";

type Cursor = { si: number; ti: number };

/** reading order of two positions: negative when a comes first */
function cmpPos(a: Cursor, b: Cursor): number {
  return a.si - b.si || a.ti - b.ti;
}

/** does a note's span cover this position? */
function covers(n: Annotation, at: Cursor): boolean {
  return cmpPos(at, { si: n.start_si, ti: n.start_ti }) >= 0 && cmpPos(at, { si: n.end_si, ti: n.end_ti }) <= 0;
}

const IMPORTANCE: { value: number; label: string }[] = [
  { value: 3, label: "High" },
  { value: 2, label: "Normal" },
  { value: 1, label: "Low" },
];

function isWordToken(t: Token) {
  return t.pos !== "punc" && t.pos !== "digit" && !!t.lemma_key;
}

function statusOf(token: Token, statuses: Record<string, string>): string {
  if (!isWordToken(token)) return "punc";
  return statuses[token.lemma_key] ?? "unknown";
}

const linkCls = (on: boolean) =>
  `hand text-sm transition-colors ${on ? "text-[var(--ink-red)] underline underline-offset-4" : "text-[var(--muted)] hover:text-[var(--fg)]"}`;

export default function Library({
  onReview,
  onWords,
  onReviewNote,
}: {
  onReview: () => void;
  onWords?: () => void;
  /** open the deck with only this note's cards */
  onReviewNote?: (textId: number) => void;
}) {
  const [texts, setTexts] = useState<TextSummary[]>([]);
  const [active, setActive] = useState<TextDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(""); // the first line is the title, the rest is the article
  const [importance, setImportance] = useState(2);
  const [newTags, setNewTags] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [mode, setMode] = useState<"write" | "paste">("write");
  const [promptText, setPromptText] = useState("");
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.listTexts().then(setTexts).catch((e) => setError(String(e)));

  // tag -> note count, derived from the notes themselves
  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    texts.forEach((t) => t.tags.forEach((g) => m.set(g.name, (m.get(g.name) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [texts]);
  const shown = tagFilter ? texts.filter((t) => t.tags.some((g) => g.name === tagFilter)) : texts;

  useEffect(() => {
    refresh();
  }, []);

  const [studyOnOpen, setStudyOnOpen] = useState(false);
  const [openNotice, setOpenNotice] = useState<string | undefined>(undefined);

  // the first line is the title; everything after it is the article
  function splitDraft() {
    const lines = draft.split("\n");
    return {
      titleText: (lines[0] ?? "").trim() || "Untitled",
      bodyText: lines.slice(1).join("\n").trim(),
    };
  }

  function closeAdd() {
    setAdding(false);
    setDraft("");
    setNewTags("");
    setNewSource("");
    setNewUrl("");
    setImportance(2);
    setMode("write");
    setReply("");
    setError(null);
  }

  async function copyText(t: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  }

  // save now: the app's own calls do the extraction and glosses
  // (copy prompt saves nothing until Claude's reply is pasted: saveNote with a reply)
  async function saveNote(glosses: "fanar" | "none", raw?: string) {
    const { titleText, bodyText } = splitDraft();
    if (!bodyText) {
      setError("write the article under the first line");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createText(titleText, bodyText, importance, glosses, {
        source: newSource,
        url: newUrl,
      });
      const names = newTags.split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length) await api.setTextTags(id, names);
      let notice: string | undefined;
      if (raw !== undefined) {
        try {
          await api.importAnalysis(id, raw);
          notice = "saved with the study data from Claude";
        } catch (e) {
          notice = `saved, but the reply did not import: ${String(e)}`;
        }
      }
      setOpenNotice(notice);
      setStudyOnOpen(false);
      setActive(await api.getText(id));
      closeAdd();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // copy prompt: build the prompt without saving, copy it, open Claude, then wait for the reply
  async function copyPrompt() {
    const { titleText, bodyText } = splitDraft();
    if (!bodyText) {
      setError("write the article under the first line");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { prompt } = await api.previewPrompt(titleText, bodyText);
      setPromptText(prompt);
      setCopied(await copyText(prompt));
      window.open("https://claude.ai/new", "_blank", "noopener");
      setMode("paste");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeText(id: number, titleText: string) {
    if (!window.confirm(`Delete "${titleText}"? The note is removed but your vocabulary stays.`)) return;
    try {
      await api.deleteText(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  if (active) {
    return (
      <ReadingView
        onCards={onReviewNote ? () => onReviewNote(active.id) : undefined}
        openStudy={studyOnOpen}
        notice0={openNotice}
        text={active}
        onDeleted={() => {
          setActive(null);
          refresh();
        }}
        onChange={(t) => setActive(t)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl" style={{ fontFamily: "var(--font-latin)" }}>
      <div className="mb-8">
        <HomeStats
          onReview={onReview}
          onWords={onWords}
          action={
            !adding ? (
              <button onClick={() => setAdding(true)} className="plus-btn" aria-label="add a note" title="add a note">
                +
              </button>
            ) : null
          }
        />
      </div>
      {error && <p className="text-sm" style={{ color: "var(--ink-red)" }}>{error}</p>}

      {adding && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center px-4 pt-[10vh]"
          style={{ background: "color-mix(in srgb, var(--fg) 24%, transparent)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAdd();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="add a note"
            className="w-full max-w-2xl rounded-sm p-6"
            style={{
              background: "var(--bg)",
              boxShadow: "0 24px 60px -24px var(--shadow)",
              border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
              fontFamily: "var(--font-latin)",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeAdd();
            }}
          >
            <div className="flex items-baseline justify-between">
              <span className="hand text-sm" style={{ color: "var(--muted)" }}>
                {mode === "write" ? "new note" : "paste the reply"}
              </span>
              <button onClick={closeAdd} className={linkCls(false)} aria-label="close">
                close
              </button>
            </div>

            {mode === "write" ? (
              <>
                <textarea
                  autoFocus
                  className="ar mt-4 w-full resize-y bg-transparent text-xl leading-relaxed outline-none"
                  rows={12}
                  placeholder={"العنوان في السطر الأول\nثم الصق المقالة هنا…"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <input
                    className="min-w-0 flex-1 basis-40 bg-transparent text-sm outline-none"
                    style={{ borderBottom: "1px dashed var(--frame)" }}
                    placeholder="source: author, book or site"
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                  />
                  <input
                    type="url"
                    className="min-w-0 flex-1 basis-40 bg-transparent text-sm outline-none"
                    style={{ borderBottom: "1px dashed var(--frame)" }}
                    placeholder="link, https://…"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    style={{ borderBottom: "1px dashed var(--frame)" }}
                    placeholder="tags, comma separated"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                  />
                  <div className="flex gap-3">
                    {IMPORTANCE.map((i) => (
                      <button
                        key={i.value}
                        onClick={() => setImportance(i.value)}
                        className={linkCls(importance === i.value)}
                      >
                        {i.label.toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    onClick={() => saveNote("fanar")}
                    disabled={busy || !splitDraft().bodyText}
                    className="rounded-sm px-4 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: "var(--ink-red)", color: "var(--bg)" }}
                  >
                    {busy ? "saving…" : "extract & save"}
                  </button>
                  <button
                    onClick={copyPrompt}
                    disabled={busy || !splitDraft().bodyText}
                    className={`${linkCls(false)} disabled:opacity-40`}
                  >
                    copy prompt for claude
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="hand mt-4 text-sm" style={{ color: "var(--muted)" }}>
                  {copied
                    ? "prompt copied. paste it into the new window, then paste Claude's JSON reply below."
                    : "couldn't copy the prompt automatically."}{" "}
                  {!copied && (
                    <button
                      onClick={async () => setCopied(await copyText(promptText))}
                      className={linkCls(false)}
                    >
                      copy again
                    </button>
                  )}
                </p>
                <textarea
                  autoFocus
                  className="mt-3 w-full resize-y bg-transparent text-sm outline-none"
                  style={{ fontFamily: "monospace", minHeight: "10rem" }}
                  rows={10}
                  placeholder="paste Claude's JSON reply here"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <div className="mt-4 flex items-center gap-5">
                  <button
                    onClick={() => saveNote("none", reply)}
                    disabled={busy || !reply.trim()}
                    className="rounded-sm px-4 py-1.5 text-sm disabled:opacity-40"
                    style={{ background: "var(--ink-red)", color: "var(--bg)" }}
                  >
                    {busy ? "saving…" : "save note"}
                  </button>
                  <button onClick={() => setMode("write")} className={linkCls(false)}>
                    back
                  </button>
                </div>
              </>
            )}

            {error && (
              <p className="mt-3 text-sm" style={{ color: "var(--ink-red)" }}>
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm" style={{ fontFamily: "var(--font-latin)" }}>
          <span className="hand" style={{ color: "var(--muted)" }}>tabs</span>
          <button
            onClick={() => setTagFilter(null)}
            className={`tab-tag ${tagFilter === null ? "on" : ""}`}
            style={{ "--tilt": "-1.2deg" } as CSSProperties}
          >
            all
          </button>
          {allTags.map(([name, count], i) => (
            <button
              key={name}
              onClick={() => setTagFilter(name)}
              className={`tab-tag ${tagFilter === name ? "on" : ""}`}
              style={{ "--tilt": `${i % 2 ? 1.1 : -1.1}deg` } as CSSProperties}
            >
              {name} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <CorkBoard
          texts={shown}
          onOpen={(t) => {
            setStudyOnOpen(false);
            setOpenNotice(undefined);
            api.getText(t.id).then(setActive);
          }}
          onDelete={(t) => removeText(t.id, t.title)}
        />
      )}

      {texts.length === 0 && !adding && (
        <div className="slip mt-8 text-center" style={{ "--tilt": "-0.5deg" } as CSSProperties}>
          <p className="hand text-lg" style={{ color: "var(--muted)" }}>the desk is empty</p>
          <p className="hand mt-1 text-sm" style={{ color: "var(--muted)" }}>
            paste your first article and it will land here
          </p>
        </div>
      )}
    </div>
  );
}

// the levels, strongest first, with their colours
const TRACK = [
  { status: "known", label: "known", color: "var(--st-3)" },
  { status: "easy", label: "easy", color: "var(--st-2)" },
  { status: "hard", label: "hard", color: "var(--st-1)" },
  { status: "not_known", label: "not known", color: "var(--st-0)" },
];

/** How far along this note is, in one line: a bar split by level (unmarked
 *  words stay pale), the share known, and this note's due cards, which open
 *  the deck on this note. The words are in the tooltips. */
function NoteTracker({ text, onCards }: { text: TextDetail; onCards?: () => void }) {
  const { counts, total } = useMemo(() => {
    const keys = new Set<string>();
    for (const s of [text.titleSentence, ...text.sentences]) for (const t of s.tokens) if (isWordToken(t)) keys.add(t.lemma_key);
    const c: Record<string, number> = { known: 0, easy: 0, hard: 0, not_known: 0, unmarked: 0 };
    keys.forEach((k) => {
      const st = text.statuses[k];
      if (st && st in c) c[st] += 1;
      else c.unmarked += 1;
    });
    return { counts: c, total: keys.size };
  }, [text]);

  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    if (!onCards) return;
    api
      .dueWords({ textIds: [text.id] })
      .then((w) => setDue(w.length))
      .catch(() => setDue(null));
  }, [text.id, text.statuses, onCards]);

  if (total === 0) return null;
  const pct = Math.round((counts.known / total) * 100);
  const breakdown = [
    `${counts.known} of ${total} words known`,
    ...TRACK.slice(1).map((t) => counts[t.status] && `${counts[t.status]} ${t.label}`),
    counts.unmarked && `${counts.unmarked} not marked yet`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="note-track" title={breakdown}>
      <div className="note-track-bar" role="img" aria-label={breakdown}>
        {TRACK.map((t) =>
          counts[t.status] > 0 ? <span key={t.status} style={{ flexGrow: counts[t.status], background: t.color }} /> : null,
        )}
        {counts.unmarked > 0 && <span className="unmarked" style={{ flexGrow: counts.unmarked }} />}
      </div>
      <span className="note-track-pct">{pct}%</span>
      {onCards && (
        <button
          onClick={onCards}
          disabled={due === 0}
          className="note-cards"
          aria-label={due === 0 ? "No cards due from this note" : `Review this note's ${due ?? ""} due cards`}
          title={due === 0 ? "No cards due from this note" : "Review this note's due cards"}
        >
          <Icon name="cards" size={15} />
          <b>{due ?? "·"}</b>
        </button>
      )}
    </div>
  );
}

/** The note's title as the heading of the reading panel, with its source and
 *  tags beneath. The pencil edits all three in place; the tick closes. */
function NoteHead({
  text,
  onChange,
  titleWords,
}: {
  text: TextDetail;
  onChange: (t: TextDetail) => void;
  /** the title drawn as words you can tap, like the body's */
  titleWords?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(text.title);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setTitle(text.title), [text.title]);

  const reload = async () => onChange(await api.getText(text.id));

  async function saveTitle() {
    const t = title.trim();
    if (!t || t === text.title) {
      setTitle(text.title);
      return;
    }
    try {
      const r = await api.setTextTitle(text.id, t);
      setErr(null);
      onChange({ ...text, title: r.title, titleSentence: r.titleSentence });
    } catch (e) {
      setErr(String(e));
    }
  }

  const tags = text.tags ?? [];
  const hasMeta = !!(text.source || text.url || tags.length);

  return (
    <header className={`note-head ${editing ? "editing" : ""}`} dir="rtl">
      <div className="note-head-row">
        {editing ? (
          <input
            autoFocus
            dir="rtl"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setTitle(text.title);
              e.stopPropagation();
            }}
            className="ar note-title note-title-input"
            aria-label="Title"
          />
        ) : (
          <h2 className="ar note-title">{titleWords ?? text.title}</h2>
        )}
        <button
          onClick={() => setEditing((v) => !v)}
          className={`icon-btn sm note-head-edit ${editing ? "on" : ""}`}
          aria-pressed={editing}
          aria-label={editing ? "Done" : "Edit title, source and tags"}
          title={editing ? "Done" : "Edit title, source and tags"}
        >
          <Icon name={editing ? "check" : "pencil"} size={13} />
        </button>
      </div>
      {editing ? (
        <div className="note-head-fields" dir="ltr" onKeyDown={(e) => e.stopPropagation()}>
          <SourceEditor
            source={text.source ?? ""}
            url={text.url ?? ""}
            onSave={async (source, url) => {
              await api.setTextSource(text.id, source, url);
              await reload();
            }}
          />
          <TagEditor
            tags={tags}
            editing
            onSave={async (names) => {
              try {
                await api.setTextTags(text.id, names);
                await reload();
              } catch (e) {
                setErr(String(e));
              }
            }}
          />
        </div>
      ) : (
        hasMeta && (
          <div className="note-head-meta">
            <SourceLine source={text.source} url={text.url} />
            {tags.map((g) => (
              <span key={g.id} className="note-head-tag hand">
                #{g.name}
              </span>
            ))}
          </div>
        )
      )}
      {err && <p className="note-head-err hand">{err}</p>}
    </header>
  );
}

/** Where a note comes from: the source's name, linked to the original when
 *  there is a link (opens in a new tab). Shows nothing when neither is set. */
function SourceLine({ source, url }: { source?: string | null; url?: string | null }) {
  if (!source && !url) return null;
  let label = source || "";
  if (!label && url) {
    try {
      label = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      label = url;
    }
  }
  return (
    <p className="note-source hand" dir="auto">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={url}>
          {label}
          <span className="note-source-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      ) : (
        <span>{label}</span>
      )}
    </p>
  );
}

function SourceEditor({
  source,
  url,
  onSave,
}: {
  source: string;
  url: string;
  onSave: (source: string, url: string) => Promise<void>;
}) {
  const [s, setS] = useState(source);
  const [u, setU] = useState(url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = s !== source || u !== url;
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await onSave(s, u);
    } catch (e) {
      setErr(String(e).includes("http") ? "the link must start with http:// or https://" : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="source-edit hand">
      <input value={s} onChange={(e) => setS(e.target.value)} placeholder="source: author, book or site" aria-label="Source" />
      <input type="url" value={u} onChange={(e) => setU(e.target.value)} placeholder="link, https://…" aria-label="Link" />
      {changed && (
        <button onClick={save} disabled={busy} className="source-save">
          {busy ? "saving…" : "save source"}
        </button>
      )}
      {err && <span className="source-err">{err}</span>}
    </div>
  );
}

type MenuItem = { label: string; onClick: () => void; danger?: boolean; keepOpen?: boolean; disabled?: boolean };

function ActionMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title="More"
        aria-label="More actions"
        aria-expanded={open}
        className="icon-btn sm"
      >
        <Icon name="more" size={15} />
      </button>
      {open && (
        <div className="frame absolute right-0 top-full z-10 mt-1 min-w-44 rounded-sm py-1">
          {items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                if (!it.keepOpen) setOpen(false);
                it.onClick();
              }}
              className="block w-full px-4 py-1.5 text-left text-sm transition-colors hover:bg-[var(--gold-soft)] disabled:opacity-40"
              style={{ color: it.danger ? "var(--ink-red)" : "var(--fg)" }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["← / j", "next word"],
  ["→ / k", "previous word"],
  ["↓ / ↑", "next / previous sentence"],
  ["1 2 3 4", "tag: Not known · Hard · Easy · Known"],
  ["i", "stars: none, 1, 2, 3"],
  ["h", "hear the word"],
  ["d", "load word details (Fanar)"],
  ["p / Space", "play sentence audio"],
  ["drag", "select words (whole words, across sentences)"],
  ["v / Enter", "start or extend a selection at this word"],
  ["a", "select the whole sentence"],
  ["n", "write in the selection's box"],
  ["s", "save the selection (as a phrase if the box is empty)"],
  ["Esc", "clear the selection"],
  ["?", "toggle this help"],
];

function ReadingView({
  text,
  onDeleted,
  onChange,
  openStudy = false,
  notice0,
  onCards,
}: {
  text: TextDetail;
  onCards?: () => void;
  onDeleted: () => void;
  onChange: (t: TextDetail) => void;
  openStudy?: boolean;
  notice0?: string;
}) {
  // the first word is picked when a text opens, so the panel is never empty
  const [cursor, setCursor] = useState<Cursor | null>(() => {
    for (let si = 0; si < text.sentences.length; si++) {
      const ti = text.sentences[si].tokens.findIndex(isWordToken);
      if (ti >= 0) return { si, ti };
    }
    return null;
  });
  // a selection of whole words, from a to b (either order), for a note or a phrase
  const [sel, setSel] = useState<{ a: Cursor; b: Cursor } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const dragFrom = useRef<Cursor | null>(null);
  const dragMoved = useRef(false);
  // stars you set while reading; the rest come with the text
  const [wordImportance, setWordImportance] = useState<Record<string, number>>({});
  const starsOf = (key: string) => wordImportance[key] ?? text.importance?.[key] ?? 0;
  // the word whose level was just set: its copies in the text pop once
  const [pulse, setPulse] = useState<{ key: string; n: number } | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [showStudy, setShowStudy] = useState(openStudy);
  const [studyFocus, setStudyFocus] = useState(0); // bumped to put the cursor in the reply box
  // on a narrow screen the one-sentence view is the default, and it takes over
  // when the window is made narrower; the toggle still works either way
  // the breakpoint is shared with the stylesheet (index.css, the .bento rules)
  const narrowQuery = "(max-width: 1199px)";
  const [focusMode, setFocusMode] = useState(() => window.matchMedia(narrowQuery).matches);
  useEffect(() => {
    const mq = window.matchMedia(narrowQuery);
    // crossing the breakpoint switches the view both ways, automatically
    const onChange = (e: MediaQueryListEvent) => setFocusMode(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [turnDir, setTurnDir] = useState<1 | -1>(1);
  const [showEn, setShowEn] = useState(false);
  // the sentence on show is its own state, so paging works before any word is picked
  const [sIdx, setSIdx] = useState(0);
  useEffect(() => {
    if (cursor) setSIdx(cursor.si);
  }, [cursor]);
  // sentences with no real word in them ("(1)", symbols, spaces) are skipped in sentence mode
  const meaningfulIdx = useMemo(
    () => text.sentences.flatMap((s, i) => (s.tokens.some(isWordToken) ? [i] : [])),
    [text],
  );
  // the sentence on show: the current one, or the next meaningful one after it
  const shownIdx =
    meaningfulIdx.includes(sIdx) ? sIdx : meaningfulIdx.find((i) => i > sIdx) ?? meaningfulIdx[meaningfulIdx.length - 1] ?? 0;
  const [arScale, setArScale] = useState(1);
  const SCALES = [0.85, 1, 1.2, 1.4];
  const [hover, setHover] = useState<{ token: Token; si: number; ti: number; rect: DOMRect } | null>(null);
  // a phone: the reading on top, and what you press in a dock at the bottom of the screen
  const phone = usePhone();
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(0);
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!phone || !el) return;
    const set = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setDockH(h);
      document.documentElement.style.setProperty("--dock-h", `${h}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--dock-h");
    };
  }, [phone]);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  /** A sentence by index; -1 is the title. */
  const sentenceOf = (si: number): Sentence => (si === -1 ? text.titleSentence : text.sentences[si]);

  // precedence: your edit > Claude's study data > CAMeL/Fanar
  const analysisWords = text.analysis?.words ?? {};
  const viewToken = (t: Token): Token => {
    const ov = text.overrides?.[t.lemma_key];
    const key = analysisKey(text.analysis, t);
    const a = key ? analysisWords[key] : undefined;
    return {
      ...t,
      gloss: ov?.gloss ?? a?.meaning ?? t.gloss,
      root: ov?.root ?? a?.root ?? t.root,
    };
  };

  async function saveMeaning(lemmaKey: string, gloss: string | null, root: string | null) {
    await api.saveOverride(lemmaKey, { gloss, root });
    const ov = { ...(text.overrides ?? {}) };
    if (gloss || root) ov[lemmaKey] = { gloss, root };
    else delete ov[lemmaKey];
    onChange({ ...text, overrides: ov });
  }

  const current: Token | null = cursor ? viewToken(sentenceOf(cursor.si).tokens[cursor.ti]) : null;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2000);
  };

  useEffect(() => {
    if (notice0) flash(notice0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setArScale(parseFloat(s.ar_text_scale) || 1);
      })
      .catch(() => {});
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const flat: Cursor[] = [];
      [text.titleSentence, ...text.sentences].forEach((s, i) =>
        s.tokens.forEach((t, ti) => {
          if (isWordToken(t)) flat.push({ si: i - 1, ti });
        }),
      );
      if (flat.length === 0) return;
      if (!cursor) {
        setCursor(flat[0]);
        return;
      }
      const idx = flat.findIndex((c) => c.si === cursor.si && c.ti === cursor.ti);
      const next = flat[Math.min(Math.max(idx + dir, 0), flat.length - 1)];
      setCursor(next);
    },
    [cursor, text],
  );

  const moveSentence = useCallback(
    (dir: 1 | -1) => {
      const target = dir > 0 ? meaningfulIdx.find((i) => i > shownIdx) : [...meaningfulIdx].reverse().find((i) => i < shownIdx);
      if (target === undefined) return;
      setTurnDir(dir);
      setSIdx(target);
      const ti = text.sentences[target].tokens.findIndex(isWordToken);
      if (ti >= 0) setCursor({ si: target, ti });
      else if (cursor) setCursor(null);
    },
    [cursor, shownIdx, meaningfulIdx, text],
  );

  function stepScale(dir: 1 | -1) {
    const i = SCALES.findIndex((v) => v === arScale);
    const nextIdx = Math.min(Math.max((i < 0 ? 1 : i) + dir, 0), SCALES.length - 1);
    const v = SCALES[nextIdx];
    setArScale(v);
    applyTextScale(String(v));
    api.saveSettings({ ar_text_scale: String(v) }).catch(() => {});
  }

  // the level shows at once (the word pops); saving follows, and is undone if it fails
  async function tag(status: string) {
    if (!current) return;
    const key = current.lemma_key;
    const was = text.statuses[key];
    if (was === status) return;
    setError(null);
    setPulse((p) => ({ key, n: (p?.n ?? 0) + 1 }));
    onChange({ ...text, statuses: { ...text.statuses, [key]: status } });
    try {
      if (was) await api.updateVocab(key, { status });
      else
        await api.addVocab({
          lemma_key: key,
          display: current.lemma,
          root: current.root,
          pos: current.pos,
          gloss: current.gloss,
          status,
          importance: starsOf(key),
        });
    } catch (e) {
      const back = { ...text.statuses };
      if (was) back[key] = was;
      else delete back[key];
      onChange({ ...text, statuses: back });
      setError(String(e));
    }
  }

  // stars are kept with the word once it is in your wallet; before that they
  // wait here and go in with its first level
  async function setStars(n: number) {
    if (!current) return;
    const key = current.lemma_key;
    setWordImportance((m) => ({ ...m, [key]: n }));
    if (text.statuses[key]) {
      try {
        await api.updateVocab(key, { importance: n });
      } catch (e) {
        setError(String(e));
      }
    }
  }

  const sayWord = () =>
    current && speak(current.diac || current.word).catch((e) => setError(String(e instanceof Error ? e.message : e)));

  // the selection in reading order, and its words
  const selRange = useMemo<[Cursor, Cursor] | null>(
    () => (sel ? (cmpPos(sel.a, sel.b) <= 0 ? [sel.a, sel.b] : [sel.b, sel.a]) : null),
    [sel],
  );
  const selQuote = useMemo(() => {
    if (!selRange) return "";
    const [a, b] = selRange;
    const words: string[] = [];
    for (let si = a.si; si <= b.si; si++) {
      const toks = sentenceOf(si).tokens;
      const lo = si === a.si ? a.ti : 0;
      const hi = si === b.si ? b.ti : toks.length - 1;
      for (let ti = lo; ti <= hi; ti++) words.push(toks[ti].word);
    }
    return words.join(" ").trim();
  }, [selRange, text]);

  const notes = text.annotations ?? [];
  // every word covered by a note, for the underline
  const noted = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes)
      for (let si = n.start_si; si <= n.end_si; si++) {
        const toks = (si === -1 ? text.titleSentence : text.sentences[si])?.tokens ?? [];
        const lo = si === n.start_si ? n.start_ti : 0;
        const hi = si === n.end_si ? n.end_ti : toks.length - 1;
        for (let ti = lo; ti <= hi; ti++) set.add(`${si}:${ti}`);
      }
    return set;
  }, [notes, text]);

  function clearSel() {
    setSel(null);
    setNoteOpen(false);
  }

  // v / Enter: start a selection at the word, or stretch it to the word
  function anchorSelection() {
    if (!cursor) return;
    setSel((cur) => (cur ? { a: cur.a, b: cursor } : { a: cursor, b: cursor }));
  }

  // a: the whole sentence the word is in
  function selectSentence() {
    if (!cursor) return;
    const toks = sentenceOf(cursor.si).tokens;
    const first = toks.findIndex(isWordToken);
    let last = toks.length - 1;
    while (last > 0 && !isWordToken(toks[last])) last--;
    if (first >= 0) setSel({ a: { si: cursor.si, ti: first }, b: { si: cursor.si, ti: last } });
  }

  // the latest text, for updates that land after a slow call
  const textRef = useRef(text);
  textRef.current = text;
  const patchNotes = (f: (ns: Annotation[]) => Annotation[]) =>
    onChange({ ...textRef.current, annotations: f(textRef.current.annotations ?? []) });

  // save the selection: with nothing written it is a phrase, with words a note.
  // It is underlined at once; the AI's meaning for it arrives a moment later.
  async function addNote(comment: string) {
    if (!selRange) return;
    const [a, b] = selRange;
    const quote = selQuote;
    const context = Array.from({ length: b.si - a.si + 1 }, (_, i) => sentenceOf(a.si + i).text).join(" ");
    setError(null);
    try {
      const note = await api.createNote({
        text_id: text.id,
        start_si: a.si,
        start_ti: a.ti,
        end_si: b.si,
        end_ti: b.ti,
        comment,
        quote,
      });
      clearSel();
      patchNotes((ns) => [...ns, note]);
      flash(comment ? "note saved" : "phrase saved");
      const meaning = await api.noteMeaning(note.id, quote, context).catch(() => null);
      if (meaning) patchNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, meaning } : n)));
    } catch (e) {
      setError(String(e));
    }
  }

  // dragging across words selects them whole; a click without a drag picks one word
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const from = dragFrom.current;
      if (!from) return;
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-ti]");
      if (!el) return;
      const at = { si: Number(el.dataset.si), ti: Number(el.dataset.ti) };
      if (!dragMoved.current && at.si === from.si && at.ti === from.ti) return;
      dragMoved.current = true;
      setDragging(true);
      setNoteOpen(false);
      setSel({ a: from, b: at });
    }
    function onUp() {
      if (dragFrom.current) {
        dragFrom.current = null;
        setDragging(false);
        if (dragMoved.current) setNoteOpen(true);
      }
    }
    // a press away from the words and the selection bar lets the selection go
    function onDown(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(".sel-bar") && !t.closest("[data-ti]")) clearSel();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  // the sentence last loaded, so pause and play resume the same audio
  const loadedFor = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const playSentence = useCallback(
    async (si: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      setError(null);
      if (playing === si) {
        audio.pause();
        setPlaying(null);
        return;
      }
      try {
        if (loadedFor.current !== si) {
          const audioBlob = await api.tts(text.sentences[si].text);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = URL.createObjectURL(audioBlob);
          audio.src = urlRef.current;
          audio.onended = () => setPlaying(null);
          loadedFor.current = si;
        }
        setPlaying(si);
        await audio.play();
      } catch (e) {
        setPlaying(null);
        setError(String(e));
      }
    },
    [text, playing],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const k = e.key;
      if (k === "ArrowLeft" || k === "j") { e.preventDefault(); move(1); }
      else if (k === "ArrowRight" || k === "k") { e.preventDefault(); move(-1); }
      else if (k === "ArrowDown") { e.preventDefault(); moveSentence(1); }
      else if (k === "ArrowUp") { e.preventDefault(); moveSentence(-1); }
      else if (k === "1") tag("not_known");
      else if (k === "2") tag("hard");
      else if (k === "3") tag("easy");
      else if (k === "4") tag("known");
      else if (k === "i" && current) setStars(nextStars(starsOf(current.lemma_key)));
      else if (k === "h") sayWord();
      else if (k === "d" && current) setDetailsFor(current.lemma_key);
      else if ((k === "p" || k === " ") && cursor) { e.preventDefault(); playSentence(cursor.si); }
      else if (k === "v" || k === "Enter") { e.preventDefault(); anchorSelection(); }
      else if (k === "a") selectSentence();
      else if (k === "s" && sel) addNote("");
      else if (k === "n" && sel) { e.preventDefault(); setNoteOpen(true); }
      else if (k === "Escape") clearSel();
      else if (k === "?") setShowHelp((h) => !h);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sentenceIdx = shownIdx;
  const hasPrev = meaningfulIdx.some((i) => i < sentenceIdx);
  const hasNext = meaningfulIdx.some((i) => i > sentenceIdx);
  const visibleSentences = focusMode
    ? [sentenceIdx]
    : text.sentences.map((_, i) => i);

  // the longest sentence sets the height of the one-sentence card, so it never jumps
  const longestSi = useMemo(
    () => meaningfulIdx.reduce((best, i) => (text.sentences[i].text.length > text.sentences[best].text.length ? i : best), meaningfulIdx[0] ?? 0),
    [text, meaningfulIdx],
  );

  const renderSentence = (si: number, twin = false) => {
    const s = sentenceOf(si);
    return (
      <span>
        {s.tokens.map((tok, ti) => {
          const st = statusOf(tok, text.statuses);
          const isCur = cursor?.si === si && cursor?.ti === ti;
          const inSel =
            !!selRange && cmpPos({ si, ti }, selRange[0]) >= 0 && cmpPos({ si, ti }, selRange[1]) <= 0;
          const isNoted = noted.has(`${si}:${ti}`);
          const pops = !!pulse && isWordToken(tok) && tok.lemma_key === pulse.key;
          // the hidden copy that sizes the card carries no position, so it is never hit
          const pos = twin ? {} : { "data-si": si, "data-ti": ti };
          return (
            <span key={ti} {...pos} className={inSel ? "tok-insel" : undefined}>
              <span
                onPointerDown={(e) => {
                  if (twin || e.button !== 0 || e.pointerType === "touch") return;
                  e.preventDefault(); // no letter-by-letter browser selection: words only
                  dragFrom.current = { si, ti };
                  dragMoved.current = false;
                }}
                onClick={() => {
                  if (dragMoved.current) {
                    dragMoved.current = false;
                    return;
                  }
                  clearSel();
                  if (isWordToken(tok)) setCursor({ si, ti });
                }}
                onMouseEnter={(e) =>
                  isWordToken(tok) &&
                  setHover({ token: viewToken(tok), si, ti, rect: e.currentTarget.getBoundingClientRect() })
                }
                onMouseLeave={() => setHover(null)}
                className={
                  st === "punc"
                    ? ""
                    : `tok tok-${st}` +
                      (isCur ? " tok-selected" : "") +
                      (isNoted ? " tok-note" : "") +
                      (pops ? ` tok-pop-${pulse.n % 2 ? "a" : "b"}` : "")
                }
              >
                {tok.word}
              </span>{" "}
            </span>
          );
        })}
        {!twin && si >= 0 && (
          <button
            onClick={() => playSentence(si)}
            title={playing === si ? "Pause" : "Listen"}
            aria-label={playing === si ? "Pause sentence" : "Listen to sentence"}
            className={`play-btn mx-1 ${playing === si ? "on" : ""}`}
          >
            <Icon name={playing === si ? "pause" : "play"} size={11} />
          </button>
        )}{" "}
      </span>
    );
  };

  const menuItems: MenuItem[] = [
          {
            label: "Mark all known",
            onClick: async () => {
              if (!window.confirm("Mark every word in this text as known?")) return;
              try {
                const { marked } = await api.markAllKnown(text.id);
                const statuses = { ...text.statuses };
                for (const s of [text.titleSentence, ...text.sentences])
                  for (const t of s.tokens) if (isWordToken(t)) statuses[t.lemma_key] = "known";
                onChange({ ...text, statuses });
                flash(`${marked} words marked known`);
              } catch (e) {
                setError(String(e));
              }
            },
          },
          {
            label: "Re-extract words (Fanar)",
            onClick: async () => {
              if (
                !window.confirm(
                  "Analyse this note's words again with Fanar?\n\nEach word gets its dictionary form, root and meaning again. Levels you set stay with the words.",
                )
              )
                return;
              flash("re-extracting the words…");
              try {
                const r = await api.reanalyze(text.id);
                onChange(await api.getText(text.id));
                flash(`${r.words} words extracted${r.moved ? `, ${r.moved} levels carried over` : ""}`);
              } catch (e) {
                setError(String(e));
              }
            },
          },
          {
            label: "Copy prompt for Claude",
            onClick: async () => {
              try {
                const { prompt } = await api.getPrompt(text.id);
                await navigator.clipboard.writeText(prompt);
                flash("prompt copied - paste it into Claude, then paste the reply here");
              } catch (e) {
                setError(String(e));
              }
              setShowStudy(true);
            },
          },
          {
            label: "Paste Claude's reply",
            onClick: () => {
              setShowStudy(true);
              setStudyFocus((n) => n + 1);
            },
          },
          ...(phone ? [] : [{ label: "Shortcuts (?)", onClick: () => setShowHelp((h) => !h) }]),
          {
            label: "Delete note",
            danger: true,
            onClick: async () => {
              if (!window.confirm(`Delete "${text.title}"? The note is removed but your vocabulary stays.`))
                return;
              try {
                await api.deleteText(text.id);
                onDeleted();
              } catch (e) {
                setError(String(e));
              }
            },
          },
  ];

  // the tools live at the top of the side panel, so the title row stays clean
  const toolsEl = (
    <div className="rv-tools tile-tools">
      <button onClick={() => stepScale(-1)} disabled={arScale <= SCALES[0]} className="icon-btn sm disabled:opacity-40" aria-label="Smaller text" title="Smaller text">
        <Icon name="smaller" size={14} />
      </button>
      <span className="rv-size">{Math.round(arScale * 100)}%</span>
      <button onClick={() => stepScale(1)} disabled={arScale >= SCALES[SCALES.length - 1]} className="icon-btn sm disabled:opacity-40" aria-label="Larger text" title="Larger text">
        <Icon name="larger" size={14} />
      </button>
      <span className="rv-sep" aria-hidden="true" />
      <button
        onClick={() => setFocusMode((f) => !f)}
        className={`icon-btn sm ${focusMode ? "on" : ""}`}
        aria-pressed={focusMode}
        aria-label="One sentence at a time"
        title="One sentence at a time"
      >
        <Icon name="sentence" size={14} />
      </button>
      <span className="rv-sep" aria-hidden="true" />
      <ActionMenu items={menuItems} />
    </div>
  );

  // ---- a phone: read on top, press at the bottom ----
  if (phone) {
    const count = meaningfulIdx.indexOf(sentenceIdx) + 1;
    const dock = (
      <div className="phone-dock" ref={dockRef} dir="ltr">
        {current && cursor && (
          <WordPanel
            key={current.lemma_key}
            phone
            token={current}
            status={text.statuses[current.lemma_key]}
            importance={starsOf(current.lemma_key)}
            autoDetails={detailsFor === current.lemma_key}
            onStatus={tag}
            onImportance={setStars}
            onError={setError}
            onEditMeaning={(g, r) => saveMeaning(current.lemma_key, g, r)}
            source="auto"
            overridden={!!text.overrides?.[current.lemma_key]}
          />
        )}
        {focusMode && (
          <nav className="phone-nav" aria-label="Sentences">
            <button onClick={() => moveSentence(1)} disabled={!hasNext} className="pn-btn" aria-label="Next sentence">
              <Icon name="prev" size={18} />
              <span>next</span>
            </button>
            <span className="pn-mid">
              <button
                onClick={() => setShowEn((v) => !v)}
                aria-pressed={showEn}
                className={`pn-en ${showEn ? "on" : ""}`}
                title="Show the English"
              >
                en
              </button>
              <span className="pn-count" aria-label={`Sentence ${count} of ${meaningfulIdx.length}`}>
                {count}/{meaningfulIdx.length}
              </span>
            </span>
            <button onClick={() => moveSentence(-1)} disabled={!hasPrev} className="pn-btn" aria-label="Previous sentence">
              <span>back</span>
              <Icon name="next" size={18} />
            </button>
          </nav>
        )}
      </div>
    );
    const phoneItems: MenuItem[] = [
      { label: `Larger text (${Math.round(arScale * 100)}%)`, onClick: () => stepScale(1), keepOpen: true, disabled: arScale >= SCALES[SCALES.length - 1] },
      { label: "Smaller text", onClick: () => stepScale(-1), keepOpen: true, disabled: arScale <= SCALES[0] },
      { label: focusMode ? "Show the whole text" : "One sentence at a time", onClick: () => setFocusMode((f) => !f) },
    ];
    return (
      <div className="phone-read" style={{ paddingBottom: dockH + 16 }}>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--ink-red)", fontFamily: "var(--font-latin)" }}>{error}</p>}
        {notice && (
          <p className="rv-toast hand" role="status">
            {notice}
          </p>
        )}
        {showStudy && (
          <StudyPanel text={text} onChange={onChange} flash={flash} focusKey={studyFocus} onClose={() => setShowStudy(false)} />
        )}
        {selRange && !dragging && (
          <SelectionBar end={selRange[1]} quote={selQuote} focus={noteOpen} onSave={addNote} onClose={clearSel} />
        )}

        <NoteHead text={text} onChange={onChange} titleWords={renderSentence(-1)} />
        <div className="phone-bar">
          <NoteTracker text={text} onCards={onCards} />
          <ActionMenu items={[...phoneItems, ...menuItems]} />
        </div>

        {focusMode ? (
          <div
            key={sentenceIdx}
            className={`frame sent-card sent-live phone-sent ar rounded-sm leading-loose ${turnDir > 0 ? "enter-next" : "enter-prev"}`}
            style={{ fontSize: "calc(1.3rem * var(--ar-scale, 1))" }}
            onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={(e) => {
              const from = swipe.current;
              swipe.current = null;
              if (!from) return;
              const dx = e.changedTouches[0].clientX - from.x;
              const dy = e.changedTouches[0].clientY - from.y;
              // a sideways swipe turns the sentence: to the right is the next one, as an Arabic page turns
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveSentence(dx > 0 ? 1 : -1);
            }}
          >
            {renderSentence(sentenceIdx)}
          </div>
        ) : (
          <div className="frame tile-sentence phone-sent ar rounded-sm leading-loose" style={{ fontSize: "calc(1.3rem * var(--ar-scale, 1))" }}>
            {visibleSentences.map((si) => (
              <span key={si}>{renderSentence(si)}</span>
            ))}
          </div>
        )}

        {focusMode && showEn && (
          <SentenceCard
            sentence={text.sentences[sentenceIdx]}
            highlighted={new Set()}
            compact={false}
            preset={text.analysis?.sentences?.[String(sentenceIdx)]}
            context={
              `Article: ${text.title}` +
              (sentenceIdx > 0 ? ` - previous sentence: ${text.sentences[sentenceIdx - 1].text}` : "")
            }
          />
        )}

        {cursor && notes.some((n) => covers(n, cursor)) && (
          <NotesHere
            notes={notes.filter((n) => covers(n, cursor))}
            onUpdated={(note) => patchNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)))}
            onDeleted={(id) => patchNotes((ns) => ns.filter((n) => n.id !== id))}
            onError={(e) => setError(e)}
          />
        )}

        {createPortal(dock, document.body)}
        <audio ref={audioRef} hidden />
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mt-2 text-sm" style={{ color: "var(--ink-red)", fontFamily: "var(--font-latin)" }}>{error}</p>}
      {/* floats over the page, so the text never moves while you read */}
      {notice && (
        <p className="rv-toast hand" role="status">
          {notice}
        </p>
      )}

      {showStudy && (
        <StudyPanel text={text} onChange={onChange} flash={flash} focusKey={studyFocus} onClose={() => setShowStudy(false)} />
      )}

      {showHelp && (
        <div
          className="mt-3 border-t border-dashed pt-2 text-xs"
          style={{ borderColor: "var(--frame)", fontFamily: "var(--font-latin)" }}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="hand" style={{ color: "var(--muted)" }}>keys</span>
            <button onClick={() => setShowHelp(false)} className="hand" style={{ color: "var(--muted)" }}>
              hide
            </button>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
            {SHORTCUTS.map(([keys, desc]) => (
              <div key={keys} className="flex items-baseline gap-2">
                <span
                  className="w-16 shrink-0 text-right"
                  style={{ color: "var(--gold)", fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' }}
                >
                  {keys}
                </span>
                <span style={{ color: "var(--muted)" }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selRange && !dragging && (
        <SelectionBar end={selRange[1]} quote={selQuote} focus={noteOpen} onSave={addNote} onClose={clearSel} />
      )}

      <div className={`mt-6 ${focusMode ? "bento" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_230px]"}`}>
        <div className={focusMode ? "wrap-text" : "min-w-0 lg:order-1"}>
          {focusMode && <NoteHead text={text} onChange={onChange} titleWords={renderSentence(-1)} />}
          {focusMode ? (
            <div className="sent-wrap">
              <button
                onClick={() => moveSentence(1)}
                disabled={!hasNext}
                className="sent-arrow to-next"
                aria-label="Next sentence"
                title="Next sentence (↓)"
              >
                <Icon name="prev" size={18} />
              </button>
              <div className="sent-stack">
                {/* hidden copy of the longest sentence: it gives the card its fixed height */}
                <div className="frame sent-card sent-twin ar rounded-sm p-8 leading-loose" aria-hidden="true" style={{ fontSize: "calc(1.3rem * var(--ar-scale, 1))" }}>
                  {renderSentence(longestSi, true)}
                </div>
                <div
                  key={sentenceIdx}
                  className={`frame sent-card sent-live ar rounded-sm p-8 leading-loose ${turnDir > 0 ? "enter-next" : "enter-prev"}`}
                  style={{ fontSize: "calc(1.3rem * var(--ar-scale, 1))" }}
                >
                  {renderSentence(sentenceIdx)}
                  <span className="sent-count" aria-label={`Sentence ${meaningfulIdx.indexOf(sentenceIdx) + 1} of ${meaningfulIdx.length}`}>
                    {meaningfulIdx.indexOf(sentenceIdx) + 1}/{meaningfulIdx.length}
                  </span>
                  <button
                    onClick={() => setShowEn((v) => !v)}
                    aria-pressed={showEn}
                    title="Show the English"
                    className={`sent-en ${showEn ? "on" : ""}`}
                  >
                    en
                  </button>
                </div>
              </div>
              <button
                onClick={() => moveSentence(-1)}
                disabled={!hasPrev}
                className="sent-arrow to-prev"
                aria-label="Previous sentence"
                title="Previous sentence (↑)"
              >
                <Icon name="next" size={18} />
              </button>
            </div>
          ) : (
            <div className="frame tile-sentence ar rounded-sm p-8 leading-loose" style={{ fontSize: "calc(1.3rem * var(--ar-scale, 1))" }}>
              <NoteHead text={text} onChange={onChange} titleWords={renderSentence(-1)} />
              {visibleSentences.map((si) => (
                <span key={si}>{renderSentence(si)}</span>
              ))}
            </div>
          )}
        </div>

        <div className={focusMode ? "wrap-word" : "lg:order-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto"}>
          <NoteTracker text={text} onCards={onCards} />
          {toolsEl}
          {current && cursor ? (
            <>
              <WordPanel
                key={current.lemma_key}
                token={current}
                status={text.statuses[current.lemma_key]}
                importance={starsOf(current.lemma_key)}
                autoDetails={detailsFor === current.lemma_key}
                onStatus={tag}
                onImportance={setStars}
                onError={setError}
                onEditMeaning={(g, r) => saveMeaning(current.lemma_key, g, r)}
                source={
                  text.overrides?.[current.lemma_key]
                    ? "edited"
                    : analysisKey(text.analysis, current)
                      ? "claude"
                      : "auto"
                }
                overridden={!!text.overrides?.[current.lemma_key]}
              />
              {notes.some((n) => covers(n, cursor)) && (
                <NotesHere
                  notes={notes.filter((n) => covers(n, cursor))}
                  onUpdated={(note) => patchNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)))}
                  onDeleted={(id) => patchNotes((ns) => ns.filter((n) => n.id !== id))}
                  onError={(e) => setError(e)}
                />
              )}
              {!focusMode && (
              <SentenceCard
                sentence={sentenceOf(cursor.si)}
                compact={false}
                preset={cursor.si >= 0 ? text.analysis?.sentences?.[String(cursor.si)] : undefined}
                highlighted={new Set([cursor.ti])}
                context={
                  cursor.si < 0
                    ? "This is the title of an article."
                    : `Article: ${text.title}` +
                      (cursor.si > 0 ? ` - previous sentence: ${text.sentences[cursor.si - 1].text}` : "")
                }
              />
              )}
            </>
          ) : (
            <p className="tap-hint hidden lg:flex" title="Click a word, or press → to start">
              <Icon name="tap" size={18} />
              <kbd>→</kbd>
            </p>
          )}
          {focusMode && showEn && (
            <SentenceCard
              sentence={text.sentences[sentenceIdx]}
              highlighted={new Set()}
              compact={false}
              preset={text.analysis?.sentences?.[String(sentenceIdx)]}
              context={
                `Article: ${text.title}` +
                (sentenceIdx > 0 ? ` - previous sentence: ${text.sentences[sentenceIdx - 1].text}` : "")
              }
            />
          )}
        </div>
      </div>

      {hover && (
        <HoverCard
          token={hover.token}
          translation={hover.si >= 0 ? text.analysis?.sentences?.[String(hover.si)] : undefined}
          notes={notes.filter((n) => covers(n, { si: hover.si, ti: hover.ti }))}
          rect={hover.rect}
        />
      )}

      <audio ref={audioRef} hidden />
    </div>
  );
}

/** The box under a selection, ready to type. Enter saves: with nothing
 *  written it is a phrase, with words a note; the AI adds the meaning either
 *  way. Sits under the last selected word. */
function SelectionBar({
  end,
  quote,
  focus,
  onSave,
  onClose,
}: {
  end: Cursor;
  quote: string;
  focus: boolean;
  onSave: (comment: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    function place() {
      const el = document.querySelector<HTMLElement>(`[data-si="${end.si}"][data-ti="${end.ti}"]`);
      if (!el) return setPos(null);
      const r = el.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPos({
        top: Math.min(r.bottom + 8, window.innerHeight - 170),
        left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)),
        width,
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [end]);

  // a drag (or n) puts the cursor in the box
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus, pos === null]);

  async function save() {
    if (busy) return;
    setBusy(true);
    await onSave(comment.trim());
    setBusy(false);
  }

  if (!pos) return null;
  const isNote = comment.trim().length > 0;
  return (
    <div
      className="sel-bar"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      role="dialog"
      aria-label="Selected words"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        e.stopPropagation();
      }}
    >
      <div className="sel-top">
        <p className="ar sel-quote" dir="rtl" title={quote}>
          {quote}
        </p>
        <button onClick={onClose} className="sel-btn" title="Clear (Esc)" aria-label="Clear the selection">
          <Icon name="close" size={12} />
        </button>
      </div>
      <textarea
        ref={box}
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="a note, or Enter to save as a phrase"
        className="sel-note-input"
        dir="auto"
      />
      <div className="sel-actions">
        <span className="sel-hint">{busy ? "finding the meaning…" : "the meaning is added for you"}</span>
        <button onClick={save} disabled={busy} className="sel-save">
          {busy ? "saving…" : isNote ? "save note" : "save phrase"}
        </button>
      </div>
    </div>
  );
}

/** The notes that cover the picked word: the words they cover, the comment
 *  (edit in place, saved when you leave it), its level as a card, and delete. */
function NotesHere({
  notes,
  onUpdated,
  onDeleted,
  onError,
}: {
  notes: Annotation[];
  onUpdated: (n: Annotation) => void;
  onDeleted: (id: number) => void;
  onError: (e: string) => void;
}) {
  return (
    <div className="notes-here">
      {notes.map((n) => (
        <NoteItem key={n.id} note={n} onUpdated={onUpdated} onDeleted={onDeleted} onError={onError} />
      ))}
    </div>
  );
}

/** One phrase or note: changes show at once and are saved behind them. */
function NoteItem({
  note,
  onUpdated,
  onDeleted,
  onError,
}: {
  note: Annotation;
  onUpdated: (n: Annotation) => void;
  onDeleted: (id: number) => void;
  onError: (e: string) => void;
}) {
  const [comment, setComment] = useState(note.comment);
  useEffect(() => setComment(note.comment), [note.comment]);

  async function save(patch: { comment?: string; status?: string; importance?: number }) {
    onUpdated({ ...note, ...patch });
    try {
      onUpdated(await api.updateNote(note.id, patch));
    } catch (e) {
      onUpdated(note);
      onError(String(e));
    }
  }

  return (
    <div className="note-item">
      <div className="note-item-head">
        <Icon name="pencil" size={11} />
        <span className="ar note-item-quote" dir="rtl" title={note.quote}>
          {note.quote}
        </span>
        <Stars value={note.importance ?? 0} onChange={(n) => save({ importance: n })} size={12} title="Importance" />
        <button
          onClick={async () => {
            if (!window.confirm("Delete this? Its card goes too.")) return;
            try {
              await api.deleteNote(note.id);
              onDeleted(note.id);
            } catch (e) {
              onError(String(e));
            }
          }}
          className="icon-btn sm"
          aria-label="Delete note"
          title="Delete note"
        >
          <Icon name="close" size={10} />
        </button>
      </div>
      {note.meaning ? (
        <p className="note-item-meaning hand">{note.meaning}</p>
      ) : (
        <p className="note-item-meaning hand pending">finding the meaning…</p>
      )}
      <textarea
        value={comment}
        rows={comment ? 2 : 1}
        dir="auto"
        placeholder="add a note…"
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => comment !== note.comment && save({ comment })}
        onKeyDown={(e) => e.stopPropagation()}
        className="note-item-text hand"
        aria-label="Note"
      />
      <StatusSlider value={note.status} hideCaption onChange={(s) => save({ status: s })} />
    </div>
  );
}

/** The sentence's English, beside the text it translates. The Arabic is not
 *  repeated here: it is already on the page. */
function SentenceCard({
  sentence,
  context,
  preset,
  compact = false,
}: {
  sentence: Sentence;
  highlighted?: Set<number>;
  context?: string;
  preset?: string;
  compact?: boolean;
}) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preset) {
      setTranslation(preset);
      setLoading(false);
      return;
    }
    setTranslation(null);
    setLoading(true);
    api
      .translate(sentence.text, context)
      .then((r) => setTranslation(r.translation))
      .catch(() => setTranslation(null))
      .finally(() => setLoading(false));
  }, [sentence.text, context, preset]);

  return (
    <div className={`sticky sticky-ctx ${compact ? "tile-en" : "mt-5"}`}>
      <div className="margin-head">
        <span>{compact ? "english" : "in context"}</span>
      </div>
      <p className="margin-en">{loading ? "translating…" : translation ?? "-"}</p>
    </div>
  );
}

function WordPanel({
  token,
  status,
  importance,
  autoDetails,
  onStatus,
  onImportance,
  onError,
  onEditMeaning,
  overridden,
  source,
  phone = false,
}: {
  phone?: boolean;
  token: Token;
  status: string | undefined;
  importance: number;
  autoDetails: boolean;
  onStatus: (s: string) => void;
  onImportance: (n: number) => void;
  onError: (e: string) => void;
  onEditMeaning: (gloss: string | null, root: string | null) => Promise<void>;
  overridden: boolean;
  source: "edited" | "claude" | "auto";
}) {
  const [info, setInfo] = useState<WordInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [gDraft, setGDraft] = useState("");
  const [rDraft, setRDraft] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const autoRan = useRef(false);

  const loadDetails = useCallback(async () => {
    setLoadingInfo(true);
    try {
      setInfo(
        await api.enrich({
          lemma_key: token.lemma_key,
          lemma: token.lemma,
          pos: token.pos,
          root: token.root,
        }),
      );
    } catch {
      /* surfaced via missing info */
    } finally {
      setLoadingInfo(false);
    }
  }, [token]);

  // the keyboard 'd' opens details once for this word
  useEffect(() => {
    if (autoDetails && !autoRan.current) {
      autoRan.current = true;
      setOpen(true);
      loadDetails();
    }
  }, [autoDetails, loadDetails]);

  async function saveNote() {
    if (!note.trim()) return;
    try {
      if (!status) await onStatus("not_known"); // must be in wallet first
      await api.updateVocab(token.lemma_key, { notes: note.trim() });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function startEdit() {
    setGDraft(token.gloss ?? "");
    setRDraft(token.root ?? "");
    setEditErr(null);
    setEditing(true);
  }

  async function saveEdit() {
    setEditErr(null);
    try {
      await onEditMeaning(gDraft.trim() || null, rDraft.trim() || null);
      setEditing(false);
    } catch (e) {
      setEditErr(String(e));
    }
  }

  async function resetEdit() {
    setEditErr(null);
    try {
      await onEditMeaning(null, null);
      setEditing(false);
    } catch (e) {
      setEditErr(String(e));
    }
  }

  const POS: Record<string, string> = {
    noun: "noun", verb: "verb", adj: "adj", adjective: "adj", adv: "adv", prep: "prep",
    conj: "conj", pron: "pron", part: "part", det: "det", abbrev: "abbr",
    noun_prop: "name", pron_dem: "pron", verb_pseudo: "verb",
  };
  const pos = token.pos ? POS[token.pos] ?? token.pos : null;
  const roots = (token.root ?? "").split(" ").filter(Boolean);

  const rootsEl = (
    <div className="wp-line">
      <span className="wp-roots" dir="rtl">
        {roots.length > 0 ? (
          roots.map((r, i) => (
            <span key={i} className="root-l ar">{r}</span>
          ))
        ) : (
          <span className="wp-dim">no root</span>
        )}
      </span>
      <span className="ar wp-lemma">{token.lemma}</span>
    </div>
  );

  const glossInput = (
    <input
      autoFocus
      value={gDraft}
      onChange={(e) => setGDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") saveEdit();
        if (e.key === "Escape") setEditing(false);
        e.stopPropagation();
      }}
      placeholder="meaning"
      className="hand wp-input wp-gloss"
    />
  );

  const pencil = (
    <button onClick={startEdit} title="Edit meaning and root" aria-label="Edit meaning" className="icon-btn sm">
      <Icon name="pencil" size={13} />
    </button>
  );

  const editEl = editing && (
    <div className="wp-edit">
      <input
        dir="rtl"
        value={rDraft}
        onChange={(e) => setRDraft(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="root, e.g. ك ت ب"
        className="ar wp-input"
      />
      <button onClick={saveEdit} className="wp-go">save</button>
      <button onClick={() => setEditing(false)} className="wp-quiet">cancel</button>
      {overridden && (
        <button onClick={resetEdit} className="wp-quiet">reset</button>
      )}
      {editErr && <span dir="ltr" className="wp-err">{editErr}</span>}
    </div>
  );

  const noteInput = (
    <>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveNote();
          e.stopPropagation();
        }}
        placeholder="note…"
        className="wp-note"
      />
      <button onClick={saveNote} title="Save note" aria-label="Save note" className={`icon-btn sm ${noteSaved ? "on" : ""}`}>
        <Icon name="check" size={13} />
      </button>
    </>
  );

  const infoBtn = (
    <button
      onClick={() => {
        setOpen((o) => !o);
        if (!info && !loadingInfo) loadDetails();
      }}
      title="Details (d)"
      aria-label="Details"
      aria-expanded={open}
      className={`info-i ${open ? "on" : ""}`}
    >
      i
    </button>
  );

  const detailsEl = (
    <>
      {open && pos && (
        <div className="mt-2 flex items-baseline justify-between text-xs" style={{ fontFamily: "var(--font-latin)" }}>
          <span className="lbl">type</span>
          <span>{pos}</span>
        </div>
      )}

      {open && loadingInfo && !info && (
        <p className="wp-dim mt-2 text-xs" style={{ fontFamily: "var(--font-latin)" }}>loading details…</p>
      )}

      {open && info && (
        <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: "color-mix(in srgb, var(--fg) 12%, transparent)" }}>
          {info.similar && info.similar.length > 0 && (
            <div>
              <div className="lbl">similar</div>
              <ul className="mt-0.5 space-y-0.5">
                {info.similar.map((s, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="ar text-xs">{s.word}</span>
                    <span className="hand text-xs" style={{ color: "var(--muted)" }}>{s.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.conjugation && Object.keys(info.conjugation).length > 0 && (
            <div>
              <div className="lbl">forms</div>
              <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {Object.entries(info.conjugation).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-xs" style={{ color: "var(--muted)" }}>{k}</dt>
                    <dd className="ar text-xs" style={{ color: "var(--gold)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {info.example?.ar && (
            <div>
              <div className="lbl">example</div>
              <p className="ar text-xs">{info.example.ar}</p>
              <p className="hand text-xs" style={{ color: "var(--muted)" }}>{info.example.en}</p>
            </div>
          )}
        </div>
      )}
    </>
  );

  // a phone: one line for the word (hear it, the word, its meaning, its
  // importance, more), then four buttons for its level; the rest behind "i"
  if (phone) {
    return (
      <div className="wp wp-phone">
        <div className="wpp-top">
          <SpeakButton text={token.diac || token.word} onError={onError} />
          <span className="ar wp-word">{token.diac}</span>
          {editing ? glossInput : <span className="hand wpp-gloss">{cleanGloss(token.gloss)}</span>}
          <Stars value={importance} onChange={onImportance} />
          {infoBtn}
        </div>
        <StatusSlider variant="chips" value={status} onChange={onStatus} />
        {(open || editing) && (
          <div className="wpp-more">
            <div className="wpp-more-line">
              {rootsEl}
              {!editing && pencil}
            </div>
            {editEl}
            <div className="wp-foot">{noteInput}</div>
            {detailsEl}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sticky wp">
      <div className="wp-head">
        <div className="wp-meta">
          {source !== "auto" && <span className={`src src-${source}`}>{source}</span>}
          <Stars value={importance} onChange={onImportance} />
        </div>
        <span className="wp-say">
          <SpeakButton text={token.diac || token.word} onError={onError} />
          <span className="ar wp-word">{token.diac}</span>
        </span>
      </div>

      {rootsEl}

      <div className="wp-meaning">
        {editing ? (
          glossInput
        ) : (
          <>
            <span className="hand wp-gloss">{cleanGloss(token.gloss)}</span>
            {pencil}
          </>
        )}
      </div>

      {editEl}

      <StatusSlider value={status} onChange={onStatus} />

      <div className="wp-foot">
        {noteInput}
        {infoBtn}
      </div>

      {detailsEl}
    </div>
  );
}

function TagEditor({
  tags,
  editing,
  onSave,
}: {
  tags: Tag[];
  editing: boolean;
  onSave: (names: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const names = tags.map((t) => t.name);
  if (!editing && tags.length === 0) return null;
  return (
    <div className="rv-tags" style={{ fontFamily: "var(--font-latin)" }}>
      {tags.map((t) => (
        <span key={t.id} className="rv-tag">
          {t.name}
          {editing && (
            <button
              onClick={() => onSave(names.filter((n) => n !== t.name))}
              title="Remove tag"
              aria-label={`Remove ${t.name}`}
              className="rv-tag-x"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {editing && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              const n = draft.trim();
              setDraft("");
              onSave([...names, n]);
            }
          }}
          placeholder="+ tag, Enter"
          className="rv-tag-input"
        />
      )}
    </div>
  );
}

function StudyPanel({
  text,
  onChange,
  flash,
  focusKey,
  onClose,
}: {
  text: TextDetail;
  onChange: (t: TextDetail) => void;
  flash: (m: string) => void;
  focusKey: number;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusKey) return;
    boxRef.current?.focus();
    boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusKey]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = text.analysis;

  async function copyPrompt() {
    setErr(null);
    try {
      const { prompt } = await api.getPrompt(text.id);
      await navigator.clipboard.writeText(prompt);
      flash("prompt copied - paste it into Claude");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function importJson() {
    if (!raw.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importAnalysis(text.id, raw);
      setRaw("");
      onChange(await api.getText(text.id));
      flash(`imported ${r.sentences} sentences, ${r.words} words`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm("Remove the imported study data for this note?")) return;
    try {
      await api.clearAnalysis(text.id);
      onChange(await api.getText(text.id));
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="frame mt-4 rounded-sm p-5" style={{ fontFamily: "var(--font-latin)" }}>
      <div className="flex items-center justify-between">
        <div className="lbl" style={{ color: "var(--muted)" }}>
          Study data · Claude
        </div>
        <button onClick={onClose} className="icon-btn sm" aria-label="Close" title="Close">
          <Icon name="close" size={12} />
        </button>
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        {a
          ? `Applied: ${Object.keys(a.sentences).length} sentence translations, ${Object.keys(a.words).length} word meanings and roots.`
          : "Nothing imported yet. Copy the prompt, run it in Claude, then paste the JSON reply below."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <button
          onClick={copyPrompt}
          className="rounded-sm border px-3 py-1"
          style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
        >
          Copy prompt
        </button>
        {a && (
          <button onClick={clear} style={{ color: "var(--muted)" }}>
            Remove study data
          </button>
        )}
      </div>
      <textarea
        ref={boxRef}
        dir="ltr"
        onKeyDown={(e) => e.stopPropagation()}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Paste Claude's JSON reply here…"
        rows={6}
        className="mt-3 w-full rounded-sm border bg-transparent p-2 text-sm outline-none"
        style={{ borderColor: "var(--frame)", fontFamily: "ui-monospace, Menlo, monospace" }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={importJson}
          disabled={busy || !raw.trim()}
          className="rounded-sm px-4 py-1 text-sm disabled:opacity-50"
          style={{ background: "var(--ink-red)", color: "var(--bg)" }}
        >
          {busy ? "Checking…" : "Import"}
        </button>
        {err && (
          <span className="text-sm" style={{ color: "var(--ink-red)" }} dir="ltr">
            {err}
          </span>
        )}
      </div>
    </div>
  );
}

/** What a word means, under the pointer. Over a kept phrase or note, its
 *  meaning (and your note) come first. */
function HoverCard({
  token,
  translation,
  notes = [],
  rect,
}: {
  token: Token;
  translation?: string;
  notes?: Annotation[];
  rect: DOMRect;
}) {
  const half = 150;
  const left = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
  // flip below the word when there is no room above it
  const above = rect.top > 140;
  const top = above ? rect.top - 8 : rect.bottom + 8;
  return (
    <div
      className="sticky hover-card"
      style={{ left, top, transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)" }}
    >
      {notes.map((n) => (
        <div key={n.id} className="hover-note">
          <div className="ar hover-note-quote" dir="rtl">{n.quote}</div>
          <div className="hand hover-note-meaning">{n.meaning || "finding the meaning…"}</div>
          {n.comment && <div className="hand hover-note-comment" dir="auto">{n.comment}</div>}
        </div>
      ))}
      <div className="ar text-base leading-snug" style={{ color: "var(--ink-red)" }}>
        {token.diac || token.word}
      </div>
      <div className="hand text-base leading-tight">{cleanGloss(token.gloss)}</div>
      {token.root && (
        <div className="ar text-sm" style={{ color: "var(--gold)" }}>
          {token.root}
        </div>
      )}
      {translation && (
        <div className="hand mt-1 text-base leading-tight" style={{ color: "var(--muted)" }}>
          {translation}
        </div>
      )}
    </div>
  );
}
