/** Everything the screens read and write. Data lives in Supabase (each row
 *  belongs to the signed-in person, enforced by row level security); the few
 *  steps that need the Fanar key run as Netlify functions under /api. */

import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from "ts-fsrs";
import { supabase } from "./supabase";
import { dediac, isWord, splitSentences, tokenize, wordKeys, type Sentence, type Token } from "./arabic";
import { analysisKey, buildPrompt, parseAnalysis } from "./study";

export type { Sentence, Token };

export type Tag = { id: number; name: string };

export type TagWithCount = Tag & { notes: number };

export type TextSummary = {
  id: number;
  title: string;
  importance: number;
  created_at: string;
  sentences: number;
  to_learn?: number; // distinct real words not yet known
  words?: number; // distinct real words in the note
  excerpt?: string; // the opening of the text, for its sticky note
  tags: Tag[];
  has_analysis: boolean;
  source?: string | null; // where the note comes from: author, book, site
  url?: string | null; // a link to the original (http/https only)
};

/** Claude-produced study data for a note (see study.ts). */
export type Analysis = {
  sentences: Record<string, string>; // sentence index -> English
  words: Record<string, { lemma: string; meaning: string; root: string | null; pos: string | null }>;
  forms?: Record<string, string>; // a written word (normalised) -> its key in words
};

export type TextDetail = {
  id: number;
  title: string;
  sentences: Sentence[];
  statuses: Record<string, string>;
  source?: string | null;
  url?: string | null;
  annotations?: Annotation[];
  tags: Tag[];
  analysis: Analysis | null;
  overrides: Record<string, { gloss: string | null; root: string | null }>;
};

export type DueWord = {
  lemma_key: string;
  display: string;
  is_phrase: number;
  root: string | null;
  pos: string | null;
  gloss: string | null;
  notes: string | null;
  importance: number;
  status: string;
  due: string | null;
  kind?: "note"; // a selection on a text, not a word: display is the selection, gloss its meaning
  comment?: string; // your note on it, if any
  before?: string; // the rest of the note's sentence, around the selection
  after?: string;
};

/** A note on a text: a span of words (it may cross sentences) and your comment.
 *  It is also a flashcard, with its own level. */
export type Annotation = {
  id: number;
  text_id: number;
  start_si: number;
  start_ti: number;
  end_si: number;
  end_ti: number;
  quote: string;
  meaning: string | null; // the AI's meaning of the selection as a whole
  comment: string; // your note; empty means a phrase
  status: string;
  due: string | null;
  created_at: string | null;
  title?: string; // in the full list: the text it belongs to
};

export type WordInfo = {
  meaning: string;
  type_ar?: string;
  root?: string | null;
  similar?: { word: string; meaning: string }[];
  conjugation?: Record<string, string>;
  example?: { ar: string; en: string };
};

export type Settings = Record<string, string>;

/** A day counts towards the streak when anything was studied. */
export type Streak = { current: number; longest: number; today: boolean; active_days: number };

export type DayActivity = { day: string; reviews: number; marks: number; texts: number };

export type Profile = {
  id: string;
  name: string;
  timezone: string;
  joined: string | null;
  today: string;
  streak: Streak;
  days: DayActivity[]; // the last 12 weeks, oldest first, one entry per day
  totals: { words: number; known: number; learning: number; texts: number; reviews: number };
};

/** The numbers on the home line and in the corner chip. */
export type Stats = {
  known: number;
  learning: number;
  hard: number;
  easy: number;
  phrases: number;
  due: number;
  texts: number;
  streak: Streak;
  name: string;
};

/** A word in the wallet. */
export type WalletWord = DueWord & { created_at: string | null };

// ---------------------------------------------------------------- helpers

const STATUSES = ["not_known", "hard", "easy", "known"] as const;
const NOTE_PREFIX = "note:"; // how a note's card is keyed in the deck
const HISTORY_DAYS = 84; // the profile shows 12 weeks
const DEFAULT_TZ = "Asia/Qatar";

const SETTINGS_DEFAULTS: Settings = {
  tts_voice: "Noor",
  ar_text_scale: "1",
  theme: "light", // light | dark | system
  card_style: "sticky", // sticky | index
};

/** Content is shown with plain hyphens: no em dashes reach the screen. */
function plain<T>(v: T): T {
  if (typeof v === "string") return v.replace(/—/g, "-") as unknown as T;
  if (Array.isArray(v)) return v.map((x) => plain(x)) as unknown as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === "lemma_key" ? x : plain(x);
    return o as T;
  }
  return v;
}

type Result<T> = { data: T | null; error: { message: string } | null };

/** The data of a Supabase call, or its error thrown. */
function must<T>({ data, error }: Result<T>): T {
  if (error) throw new Error(error.message);
  return data as T;
}

/** Every row of a query, a page at a time (Supabase returns at most 1000 per call). */
async function all<T>(page: (from: number, to: number) => PromiseLike<Result<unknown>>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = ((must(await page(from, from + size - 1)) ?? []) as T[]);
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("sign in first");
  return id;
}

/** A server function (Netlify) with the caller's session. */
async function serverFn(name: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      /* not json: a platform error page */
    }
    throw new Error(`${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

const serverJson = async <T>(name: string, body: unknown): Promise<T> => (await serverFn(name, body)).json();

const logActivity = (kind: "reviews" | "marks" | "texts") =>
  supabase.rpc("log_activity", { kind }).then(({ error }) => {
    if (error) console.warn("activity not logged:", error.message);
  });

// ---- cards: FSRS, the same schedule the old backend used ----

const scheduler = fsrs({ enable_fuzz: true });
const RATING: Record<string, Grade> = {
  not_known: Rating.Again,
  hard: Rating.Hard,
  easy: Rating.Good,
  known: Rating.Easy,
};

function loadCard(j: unknown): Card {
  const c = (j ?? {}) as Record<string, unknown>;
  if (typeof c.stability !== "number" || typeof c.state !== "number" || !c.due) return createEmptyCard();
  return {
    due: new Date(c.due as string),
    stability: c.stability,
    difficulty: Number(c.difficulty) || 0,
    elapsed_days: Number(c.elapsed_days) || 0,
    scheduled_days: Number(c.scheduled_days) || 0,
    learning_steps: Number(c.learning_steps) || 0,
    reps: Number(c.reps) || 0,
    lapses: Number(c.lapses) || 0,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review as string) : undefined,
  };
}

const saveCard = (c: Card) => ({
  ...c,
  due: c.due.toISOString(),
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

/** A card after a review at the given level. */
function nextCard(cardJson: unknown, status: string) {
  const { card } = scheduler.next(loadCard(cardJson), new Date(), RATING[status]);
  return { card_json: saveCard(card), due: card.due.toISOString() };
}

function newCard() {
  const card = createEmptyCard();
  return { card_json: saveCard(card), due: card.due.toISOString() };
}

// ---- days in the person's own time zone ----

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of `d` in `tz`. */
function dayIn(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: validTz(tz) ? tz : DEFAULT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Current streak (alive until the end of today), longest, and whether today counts. */
function streakOf(active: Set<string>, today: string): Streak {
  const studiedToday = active.has(today);
  let d = studiedToday ? today : addDays(today, -1);
  let current = 0;
  while (active.has(d)) {
    current += 1;
    d = addDays(d, -1);
  }
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of [...active].sort()) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return { current, longest, today: studiedToday, active_days: active.size };
}

type ProfileRow = { id: string; name: string; timezone: string; created_at: string };

async function profileRow(): Promise<ProfileRow> {
  const id = await uid();
  const found = must(
    await supabase.from("profiles").select("id, name, timezone, created_at").eq("id", id).maybeSingle(),
  ) as ProfileRow | null;
  if (found) return found;
  // created before the sign-up trigger existed: make it now
  return must(
    await supabase.from("profiles").insert({ id }).select("id, name, timezone, created_at").single(),
  ) as ProfileRow;
}

async function activityDays(): Promise<DayActivity[]> {
  return all<DayActivity>((a, b) =>
    supabase.from("activity").select("day, reviews, marks, texts").order("day").range(a, b),
  );
}

type Counts = { by_status: Record<string, number>; phrases: number; due: number; texts: number; reviews: number };

const studyCounts = async () => must(await supabase.rpc("study_counts")) as Counts;

// ---- texts ----

const clean = (s: string | null | undefined, max: number) => (s ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, max);

/** Trim both; blank means none. Links must be http(s), so a pasted
 *  'javascript:' or 'data:' address can never become a clickable link. */
function cleanSource(source?: string | null, url?: string | null) {
  const s = clean(source, 200) || null;
  const u = (url ?? "").trim().slice(0, 500) || null;
  if (u && !/^https?:\/\/\S+$/i.test(u)) throw new Error("the link must start with http:// or https://");
  return { source: s, url: u };
}

type Form = { lemma: string; root: string | null; pos: string | null; gloss: string | null; diac: string };

/** Each distinct written word, analysed by the server in small batches
 *  (a few at a time, so every call ends well inside its time limit). */
async function analyseForms(words: string[]): Promise<Record<string, Form>> {
  const batches: string[][] = [];
  for (let i = 0; i < words.length; i += 16) batches.push(words.slice(i, i + 16));
  const out: Record<string, Form> = {};
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        Object.assign(out, (await serverJson<{ forms: Record<string, Form> }>("analyze", { words: batch })).forms);
      } catch (e) {
        errors.push(e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, batches.length) }, worker));
  if (batches.length && errors.length === batches.length) {
    throw new Error(`could not analyse the words (${String(errors[0])}). Save with Claude's reply instead, or try again.`);
  }
  return out;
}

async function analyseText(body: string, withFanar: boolean): Promise<Sentence[]> {
  const sentences = splitSentences(body).map((text) => ({ text, tokens: tokenize(text) }));
  if (!sentences.length) throw new Error("empty text");
  if (!withFanar) return sentences;
  const words = [...new Set(sentences.flatMap((s) => s.tokens.filter((t) => t.pos === null).map((t) => t.word)))];
  const forms = await analyseForms(words);
  for (const s of sentences) {
    s.tokens = s.tokens.map((t): Token => {
      const f = t.pos === null ? forms[t.word] : undefined;
      if (!f) return t;
      return {
        word: t.word,
        diac: f.diac || t.word,
        lemma: f.lemma,
        lemma_key: dediac(f.lemma).trim() || t.lemma_key,
        root: f.root,
        pos: f.pos,
        gloss: f.gloss,
      };
    });
  }
  return sentences;
}

type NoteRow = Omit<Annotation, "title"> & { texts?: { title: string; tokens_json?: Sentence[] } | null };

const noteOf = (r: NoteRow, title?: string): Annotation => ({
  id: r.id,
  text_id: r.text_id,
  start_si: r.start_si,
  start_ti: r.start_ti,
  end_si: r.end_si,
  end_ti: r.end_ti,
  quote: r.quote,
  meaning: r.meaning,
  comment: r.comment,
  status: r.status,
  due: r.due,
  created_at: r.created_at,
  ...(title !== undefined ? { title } : {}),
});

const NOTE_COLS = "id, text_id, start_si, start_ti, end_si, end_ti, quote, meaning, comment, status, due, created_at";

/** The words around a selection in its first and last sentence. */
function spanParts(sentences: Sentence[], n: Pick<Annotation, "start_si" | "start_ti" | "end_si" | "end_ti">) {
  try {
    const s0 = sentences[n.start_si].tokens;
    const s1 = sentences[n.end_si].tokens;
    return {
      before: s0.slice(0, n.start_ti).map((t) => t.word).join(" "),
      after: s1.slice(n.end_ti + 1).map((t) => t.word).join(" "),
    };
  } catch {
    return { before: "", after: "" };
  }
}

type WordRow = Omit<WalletWord, "is_phrase"> & { is_phrase: boolean };
const WORD_COLS = "lemma_key, display, is_phrase, root, pos, gloss, notes, status, importance, due, created_at";
const walletOf = (r: WordRow): WalletWord => ({ ...r, is_phrase: r.is_phrase ? 1 : 0 });

let settingsCache: Promise<Settings> | null = null;

// ---------------------------------------------------------------- the API

const calls = {
  listTexts: async (): Promise<TextSummary[]> => {
    const rows = must(await supabase.rpc("texts_overview")) as TextSummary[];
    return rows ?? [];
  },

  getText: async (id: number): Promise<TextDetail> => {
    const [text, statuses, overrides, tags, notes, analysis] = await Promise.all([
      supabase.from("texts").select("id, title, source, url, tokens_json").eq("id", id).maybeSingle(),
      supabase.rpc("text_statuses", { p_text_id: id }),
      all<{ lemma_key: string; gloss: string | null; root: string | null }>((a, b) =>
        supabase.from("meaning_overrides").select("lemma_key, gloss, root").range(a, b),
      ),
      supabase.from("text_tags").select("tags(id, name)").eq("text_id", id),
      supabase.from("annotations").select(NOTE_COLS).eq("text_id", id).order("start_si").order("start_ti"),
      supabase.from("note_analysis").select("analysis_json").eq("text_id", id).maybeSingle(),
    ]);
    const t = must(text) as { id: number; title: string; source: string | null; url: string | null; tokens_json: Sentence[] } | null;
    if (!t) throw new Error("404: text not found");
    const tagRows = (must(tags) ?? []) as unknown as { tags: Tag | null }[];
    return {
      id: t.id,
      title: t.title,
      source: t.source,
      url: t.url,
      sentences: t.tokens_json,
      statuses: (must(statuses) as Record<string, string>) ?? {},
      overrides: Object.fromEntries(overrides.map((o) => [o.lemma_key, { gloss: o.gloss, root: o.root }])),
      tags: tagRows
        .map((r) => r.tags)
        .filter((g): g is Tag => !!g)
        .sort((a, b) => a.name.localeCompare(b.name)),
      annotations: ((must(notes) ?? []) as NoteRow[]).map((r) => noteOf(r)),
      analysis: ((must(analysis) as { analysis_json: Analysis } | null)?.analysis_json ?? null),
    };
  },

  createText: async (
    title: string,
    body: string,
    importance = 2,
    glosses: "fanar" | "none" = "fanar",
    origin: { source?: string; url?: string } = {},
  ): Promise<{ id: number; sentences: number }> => {
    if (![1, 2, 3].includes(importance)) throw new Error("importance must be 1-3");
    const { source, url } = cleanSource(origin.source, origin.url);
    const sentences = await analyseText(body, glosses === "fanar");
    const row = must(
      await supabase
        .from("texts")
        .insert({ title: clean(title, 200) || "Untitled", body, tokens_json: sentences, importance, source, url })
        .select("id")
        .single(),
    ) as { id: number };
    await logActivity("texts");
    return { id: row.id, sentences: sentences.length };
  },

  /** Analyse a saved note's words again with Fanar. Levels you set on a word
   *  that was keyed by its written form (a note saved with Claude's reply)
   *  move to its dictionary form, unless that form is already in your wallet. */
  reanalyze: async (id: number): Promise<{ words: number; moved: number }> => {
    const t = must(await supabase.from("texts").select("body, tokens_json").eq("id", id).maybeSingle()) as {
      body: string;
      tokens_json: Sentence[];
    } | null;
    if (!t) throw new Error("404: text not found");
    const fresh = await analyseText(t.body, true);
    const moves = new Map<string, string>();
    t.tokens_json.forEach((s, si) =>
      s.tokens.forEach((old, ti) => {
        const now = fresh[si]?.tokens[ti];
        if (now && old.pos === null && now.word === old.word && isWord(now) && now.lemma_key !== old.lemma_key) {
          moves.set(old.lemma_key, now.lemma_key);
        }
      }),
    );
    let moved = 0;
    if (moves.size) {
      const keys = [...new Set([...moves.keys(), ...moves.values()])];
      const have = new Set<string>();
      for (let i = 0; i < keys.length; i += 80) {
        const rows = must(await supabase.from("words").select("lemma_key").in("lemma_key", keys.slice(i, i + 80))) as {
          lemma_key: string;
        }[];
        for (const r of rows ?? []) have.add(r.lemma_key);
      }
      const todo = [...moves].filter(([from, to]) => have.has(from) && !have.has(to));
      for (let i = 0; i < todo.length; i += 10) {
        await Promise.all(
          todo.slice(i, i + 10).map(async ([from, to]) => {
            const { error } = await supabase.from("words").update({ lemma_key: to }).eq("lemma_key", from);
            if (!error) moved++;
          }),
        );
      }
    }
    must(await supabase.from("texts").update({ tokens_json: fresh }).eq("id", id));
    return { words: wordKeys(fresh).size, moved };
  },

  setTextTitle: async (id: number, title: string) => {
    const t = clean(title, 200);
    if (!t) throw new Error("the title cannot be empty");
    const rows = must(await supabase.from("texts").update({ title: t }).eq("id", id).select("id"));
    if (!rows?.length) throw new Error("404: text not found");
    return { id, title: t };
  },

  setTextSource: async (id: number, source: string, url: string) => {
    const c = cleanSource(source, url);
    const rows = must(await supabase.from("texts").update(c).eq("id", id).select("id"));
    if (!rows?.length) throw new Error("404: text not found");
    return { id, ...c };
  },

  setImportance: async (id: number, importance: number) => {
    if (![1, 2, 3].includes(importance)) throw new Error("importance must be 1-3");
    must(await supabase.from("texts").update({ importance }).eq("id", id));
    return { id, importance };
  },

  deleteText: async (id: number) => {
    // tags, study data and notes on the text go with it (on delete cascade)
    must(await supabase.from("texts").delete().eq("id", id));
    return { ok: true };
  },

  addVocab: async (entry: {
    lemma_key: string;
    display: string;
    root?: string | null;
    pos?: string | null;
    gloss?: string | null;
    notes?: string | null;
    is_phrase?: boolean;
    status?: string;
    importance?: number;
  }) => {
    const status = entry.status ?? "not_known";
    const importance = entry.importance ?? 0;
    if (!(STATUSES as readonly string[]).includes(status)) throw new Error("bad status");
    if (![0, 1, 2, 3].includes(importance)) throw new Error("importance must be 0-3");
    const key = dediac(entry.lemma_key).trim();
    if (!key) throw new Error("empty lemma_key");
    let gloss = entry.gloss ?? null;
    if (entry.is_phrase && !gloss) {
      // a phrase gets its translation
      gloss = await serverJson<{ translation: string | null }>("translate", { text: entry.display, lenient: true })
        .then((r) => r.translation)
        .catch(() => null);
    }
    const { error } = await supabase.from("words").insert({
      lemma_key: key,
      display: entry.display,
      is_phrase: !!entry.is_phrase,
      root: entry.root ?? null,
      pos: entry.pos ?? null,
      gloss,
      notes: entry.notes ?? null,
      status,
      importance,
      ...newCard(),
    });
    if (error?.code === "23505") {
      // already in the wallet: only the level changes
      must(await supabase.from("words").update({ status }).eq("lemma_key", key));
    } else if (error) throw new Error(error.message);
    await logActivity("marks");
    return { lemma_key: key, status, gloss };
  },

  updateVocab: async (lemmaKey: string, patch: { status?: string; importance?: number; notes?: string }) => {
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(patch.status)) throw new Error("bad status");
      set.status = patch.status;
    }
    if (patch.importance !== undefined) {
      if (![0, 1, 2, 3].includes(patch.importance)) throw new Error("importance must be 0-3");
      set.importance = patch.importance;
    }
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (!Object.keys(set).length) throw new Error("nothing to update");
    const rows = must(await supabase.from("words").update(set).eq("lemma_key", lemmaKey).select("lemma_key"));
    if (!rows?.length) throw new Error("404: word not in wallet");
    if (patch.status !== undefined) await logActivity("marks");
    return { lemma_key: lemmaKey, ok: true };
  },

  listWords: async (): Promise<WalletWord[]> =>
    (
      await all<WordRow>((a, b) =>
        supabase
          .from("words")
          .select(WORD_COLS)
          .order("importance", { ascending: false })
          .order("created_at", { ascending: false })
          .range(a, b),
      )
    ).map(walletOf),

  listNotes: async (): Promise<Annotation[]> =>
    (
      await all<NoteRow>((a, b) =>
        supabase
          .from("annotations")
          .select(`${NOTE_COLS}, texts(title)`)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(a, b),
      )
    ).map((r) => noteOf(r, r.texts?.title ?? "")),

  createNote: async (n: {
    text_id: number;
    start_si: number;
    start_ti: number;
    end_si: number;
    end_ti: number;
    comment: string;
  }): Promise<Annotation> => {
    const t = must(
      await supabase.from("texts").select("tokens_json").eq("id", n.text_id).maybeSingle(),
    ) as { tokens_json: Sentence[] } | null;
    if (!t) throw new Error("404: text not found");
    const sentences = t.tokens_json;
    let a: [number, number] = [n.start_si, n.start_ti];
    let b: [number, number] = [n.end_si, n.end_ti];
    if (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1])) [a, b] = [b, a];
    const inside = (p: [number, number]) => p[0] >= 0 && p[0] < sentences.length && p[1] >= 0 && p[1] < sentences[p[0]].tokens.length;
    if (!inside(a) || !inside(b)) throw new Error("the selection is outside the text");
    const words: string[] = [];
    for (let si = a[0]; si <= b[0]; si++) {
      const toks = sentences[si].tokens;
      const lo = si === a[0] ? a[1] : 0;
      const hi = si === b[0] ? b[1] : toks.length - 1;
      words.push(...toks.slice(lo, hi + 1).map((x) => x.word));
    }
    const quote = words.join(" ").trim();
    if (!quote) throw new Error("empty selection");
    const context = sentences.slice(a[0], b[0] + 1).map((s) => s.text).join(" ");
    // the selection's meaning as a whole, read in its sentence; saved either way
    const meaning = await serverJson<{ translation: string | null }>("translate", { text: quote, context, lenient: true })
      .then((r) => r.translation)
      .catch(() => null);
    const row = must(
      await supabase
        .from("annotations")
        .insert({
          text_id: n.text_id,
          start_si: a[0],
          start_ti: a[1],
          end_si: b[0],
          end_ti: b[1],
          quote,
          meaning,
          comment: (n.comment ?? "").trim().slice(0, 2000),
          ...newCard(),
        })
        .select(NOTE_COLS)
        .single(),
    ) as NoteRow;
    await logActivity("marks");
    return noteOf(row);
  },

  updateNote: async (id: number, patch: { comment?: string; status?: string }): Promise<Annotation> => {
    const set: Record<string, unknown> = {};
    if (patch.comment !== undefined) set.comment = patch.comment.trim().slice(0, 2000);
    if (patch.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(patch.status)) throw new Error("bad status");
      set.status = patch.status;
    }
    if (!Object.keys(set).length) throw new Error("nothing to update");
    const rows = must(await supabase.from("annotations").update(set).eq("id", id).select(NOTE_COLS)) as NoteRow[];
    if (!rows?.length) throw new Error("404: note not found");
    if (patch.status !== undefined) await logActivity("marks");
    return noteOf(rows[0]);
  },

  deleteNote: async (id: number) => {
    must(await supabase.from("annotations").delete().eq("id", id));
    return { ok: true };
  },

  getProfile: async (): Promise<Profile> => {
    const [p, days, counts] = await Promise.all([profileRow(), activityDays(), studyCounts()]);
    const today = dayIn(p.timezone);
    const active = new Set(days.filter((d) => d.reviews + d.marks + d.texts > 0).map((d) => d.day));
    const byDay = new Map(days.map((d) => [d.day, d]));
    const start = addDays(today, -(HISTORY_DAYS - 1));
    const history: DayActivity[] = Array.from({ length: HISTORY_DAYS }, (_, i) => {
      const day = addDays(start, i);
      const r = byDay.get(day);
      return { day, reviews: r?.reviews ?? 0, marks: r?.marks ?? 0, texts: r?.texts ?? 0 };
    });
    const s = counts.by_status;
    return {
      id: p.id,
      name: p.name,
      timezone: p.timezone,
      joined: p.created_at,
      today,
      streak: streakOf(active, today),
      days: history,
      totals: {
        words: Object.values(s).reduce((a, b) => a + b, 0),
        known: s.known ?? 0,
        learning: (s.not_known ?? 0) + (s.hard ?? 0) + (s.easy ?? 0),
        texts: counts.texts,
        reviews: counts.reviews,
      },
    };
  },

  updateProfile: async (patch: { name?: string; timezone?: string }): Promise<Profile> => {
    const set: Record<string, string> = {};
    if (patch.name !== undefined) {
      const name = clean(patch.name, 1000);
      if (name.length < 1 || name.length > 60) throw new Error("name must be 1-60 characters");
      set.name = name;
    }
    if (patch.timezone !== undefined) {
      if (!validTz(patch.timezone)) throw new Error("unknown time zone");
      set.timezone = patch.timezone;
    }
    if (!Object.keys(set).length) throw new Error("nothing to update");
    const p = await profileRow();
    must(await supabase.from("profiles").update(set).eq("id", p.id));
    return calls.getProfile();
  },

  stats: async (): Promise<Stats> => {
    const [p, days, counts] = await Promise.all([profileRow(), activityDays(), studyCounts()]);
    const active = new Set(days.filter((d) => d.reviews + d.marks + d.texts > 0).map((d) => d.day));
    const s = counts.by_status;
    return {
      known: s.known ?? 0,
      learning: (s.not_known ?? 0) + (s.hard ?? 0) + (s.easy ?? 0),
      hard: s.hard ?? 0,
      easy: s.easy ?? 0,
      phrases: counts.phrases,
      due: counts.due,
      texts: counts.texts,
      streak: streakOf(active, dayIn(p.timezone)),
      name: p.name,
    };
  },

  listTags: async (): Promise<TagWithCount[]> => {
    const rows = must(await supabase.from("tags").select("id, name, text_tags(count)").order("name")) as {
      id: number;
      name: string;
      text_tags: { count: number }[];
    }[];
    return (rows ?? []).map((r) => ({ id: r.id, name: r.name, notes: r.text_tags?.[0]?.count ?? 0 }));
  },

  /** Replace the note's tag set; unknown names are created. */
  setTextTags: async (id: number, names: string[]) => {
    const tags = [...new Set(names.map((n) => clean(n, 80)).filter(Boolean))];
    const user_id = await uid();
    if (tags.length) {
      must(
        await supabase
          .from("tags")
          .upsert(tags.map((name) => ({ user_id, name })), { onConflict: "user_id,name", ignoreDuplicates: true }),
      );
    }
    const ids = tags.length
      ? ((must(await supabase.from("tags").select("id").in("name", tags)) ?? []) as { id: number }[])
      : [];
    must(await supabase.from("text_tags").delete().eq("text_id", id));
    if (ids.length) must(await supabase.from("text_tags").insert(ids.map((g) => ({ text_id: id, tag_id: g.id }))));
    return { tags };
  },

  getPrompt: async (id: number) => {
    const t = must(await supabase.from("texts").select("title, body").eq("id", id).maybeSingle()) as {
      title: string;
      body: string;
    } | null;
    if (!t) throw new Error("404: text not found");
    const sentences = splitSentences(t.body);
    return { prompt: buildPrompt(t.title, sentences), sentences: sentences.length };
  },

  /** The copy-prompt for a note that is not saved yet. Nothing is written. */
  previewPrompt: async (title: string, body: string) => {
    const sentences = splitSentences(body);
    if (!sentences.length) throw new Error("empty text");
    return { prompt: buildPrompt(title.trim() || "Untitled", sentences), sentences: sentences.length };
  },

  importAnalysis: async (id: number, raw: string) => {
    const analysis = parseAnalysis(raw);
    must(await supabase.from("note_analysis").upsert({ text_id: id, analysis_json: analysis }));
    // words the app has not analysed (a note saved with Claude's reply) take
    // Claude's lemma, root and meaning, so the wallet keys them by dictionary form
    const t = must(await supabase.from("texts").select("tokens_json").eq("id", id).maybeSingle()) as {
      tokens_json: Sentence[];
    } | null;
    if (t) {
      let changed = 0;
      const sentences = t.tokens_json.map((s) => ({
        ...s,
        tokens: s.tokens.map((tok): Token => {
          if (tok.pos !== null) return tok;
          const key = analysisKey(analysis, tok);
          const w = key ? analysis.words[key] : undefined;
          if (!key || !w) return tok;
          changed++;
          return { ...tok, lemma: w.lemma, lemma_key: key, root: w.root, pos: w.pos ?? "other", gloss: w.meaning };
        }),
      }));
      if (changed) must(await supabase.from("texts").update({ tokens_json: sentences }).eq("id", id));
    }
    // fill in roots for wallet words that have none yet (never overwrite)
    const rootless = await all<{ lemma_key: string }>((a, b) =>
      supabase.from("words").select("lemma_key").is("root", null).range(a, b),
    );
    await Promise.all(
      rootless
        .map((w) => [w.lemma_key, analysis.words[w.lemma_key]?.root] as const)
        .filter(([, root]) => !!root)
        .map(([key, root]) => supabase.from("words").update({ root }).eq("lemma_key", key).is("root", null)),
    );
    return { sentences: Object.keys(analysis.sentences).length, words: Object.keys(analysis.words).length };
  },

  /** Edit a word's meaning and/or root. Both empty removes the edit. */
  saveOverride: async (lemmaKey: string, patch: { gloss: string | null; root: string | null }) => {
    const key = dediac(lemmaKey).trim();
    if (!key) throw new Error("empty lemma_key");
    const gloss = (patch.gloss ?? "").trim() || null;
    const root = (patch.root ?? "").replace(/\./g, " ").split(/\s+/).filter(Boolean).join(" ") || null;
    if (gloss === null && root === null) {
      must(await supabase.from("meaning_overrides").delete().eq("lemma_key", key));
    } else {
      must(
        await supabase
          .from("meaning_overrides")
          .upsert({ user_id: await uid(), lemma_key: key, gloss, root }, { onConflict: "user_id,lemma_key" }),
      );
    }
    // keep the wallet in step so review cards show the edit too
    const set: Record<string, string> = {};
    if (gloss !== null) set.gloss = gloss;
    if (root !== null) set.root = root;
    if (Object.keys(set).length) must(await supabase.from("words").update(set).eq("lemma_key", key));
    return { lemma_key: key, gloss, root };
  },

  clearAnalysis: async (id: number) => {
    must(await supabase.from("note_analysis").delete().eq("text_id", id));
    return { ok: true };
  },

  /** Due cards (words, then your notes), limited to the given notes and every note with a given tag. */
  dueWords: async (scope?: { tagIds?: number[]; textIds?: number[] }): Promise<DueWord[]> => {
    const now = new Date().toISOString();
    const textIds = new Set(scope?.textIds ?? []);
    if (scope?.tagIds?.length) {
      const rows = must(await supabase.from("text_tags").select("text_id").in("tag_id", scope.tagIds)) as {
        text_id: number;
      }[];
      for (const r of rows ?? []) textIds.add(r.text_id);
    }
    const scoped = !!(scope?.tagIds?.length || scope?.textIds?.length);
    let keys: Set<string> | null = null;
    if (scoped) {
      keys = new Set();
      if (textIds.size) {
        const rows = must(await supabase.from("texts").select("word_keys").in("id", [...textIds])) as {
          word_keys: string[] | null;
        }[];
        for (const r of rows ?? []) for (const k of r.word_keys ?? []) keys.add(k);
      }
    }
    const [words, notes] = await Promise.all([
      all<WordRow>((a, b) =>
        supabase
          .from("words")
          .select(WORD_COLS)
          .neq("status", "known")
          .or(`due.is.null,due.lte."${now}"`)
          .order("importance", { ascending: false })
          .order("due", { ascending: true, nullsFirst: true })
          .range(a, b),
      ),
      all<NoteRow>((a, b) =>
        supabase
          .from("annotations")
          .select(`${NOTE_COLS}, texts(title, tokens_json)`)
          .neq("status", "known")
          .or(`due.is.null,due.lte."${now}"`)
          .order("due", { ascending: true, nullsFirst: true })
          .range(a, b),
      ),
    ]);
    const wordCards: DueWord[] = words
      .filter((w) => !keys || keys.has(w.lemma_key))
      .map((w) => {
        const { created_at: _created, ...rest } = walletOf(w);
        void _created;
        return rest;
      });
    const noteCards: DueWord[] = notes
      .filter((n) => !scoped || textIds.has(n.text_id))
      .map((n) => ({
        lemma_key: `${NOTE_PREFIX}${n.id}`,
        display: n.quote,
        is_phrase: 1,
        root: null,
        pos: null,
        gloss: n.meaning ?? "",
        comment: n.comment,
        notes: n.texts?.title ?? null,
        importance: 0,
        status: n.status,
        due: n.due,
        kind: "note" as const,
        ...spanParts(n.texts?.tokens_json ?? [], n),
      }));
    return [...wordCards, ...noteCards];
  },

  /** The level you press is the grade; a note's card is scheduled like a word's. */
  grade: async (lemmaKey: string, status: string) => {
    if (!RATING[status]) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
    const isNote = lemmaKey.startsWith(NOTE_PREFIX);
    const table = isNote ? "annotations" : "words";
    const col = isNote ? "id" : "lemma_key";
    const key: string | number = isNote ? Number(lemmaKey.slice(NOTE_PREFIX.length)) : lemmaKey;
    const row = must(await supabase.from(table).select("card_json").eq(col, key).maybeSingle()) as {
      card_json: unknown;
    } | null;
    if (!row) throw new Error(isNote ? "404: note not found" : "404: word not in wallet");
    const { card_json, due } = nextCard(row.card_json, status);
    must(await supabase.from(table).update({ status, card_json, due }).eq(col, key));
    await logActivity("reviews");
    return { lemma_key: lemmaKey, status, due };
  },

  /** A sentence read aloud, as audio. */
  tts: async (text: string): Promise<Blob> => {
    const voice = (await calls.getSettings().catch(() => SETTINGS_DEFAULTS)).tts_voice;
    return (await serverFn("tts", { text, voice })).blob();
  },

  markAllKnown: async (id: number) => {
    const marked = must(await supabase.rpc("mark_all_known", { p_text_id: id })) as number;
    return { marked: marked ?? 0 };
  },

  enrich: (entry: { lemma_key: string; lemma: string; pos?: string | null; root?: string | null }) =>
    serverJson<WordInfo>("enrich", entry),

  translate: (text: string, context?: string) =>
    serverJson<{ translation: string }>("translate", { text, context }),

  getSettings: (): Promise<Settings> => {
    settingsCache ??= (async () => {
      const rows = must(await supabase.from("settings").select("key, value")) as { key: string; value: string }[];
      return { ...SETTINGS_DEFAULTS, ...Object.fromEntries((rows ?? []).map((r) => [r.key, r.value])) };
    })().catch((e) => {
      settingsCache = null;
      throw e;
    });
    return settingsCache;
  },

  saveSettings: async (values: Settings): Promise<Settings> => {
    const user_id = await uid();
    must(
      await supabase
        .from("settings")
        .upsert(
          Object.entries(values).map(([key, value]) => ({ user_id, key, value: String(value) })),
          { onConflict: "user_id,key" },
        ),
    );
    settingsCache = null;
    return calls.getSettings();
  },
};

export type Calls = typeof calls;

let backend: Calls = calls;

/** Send every call somewhere else (the try-it demo, all in memory), or back
 *  to Supabase with null. */
export function setBackend(b: Calls | null) {
  backend = b ?? calls;
  settingsCache = null;
}

/** Every call's result passes through plain(). */
export const api = Object.fromEntries(
  Object.keys(calls).map((name) => [
    name,
    async (...args: unknown[]) =>
      plain(await (backend[name as keyof Calls] as (...a: unknown[]) => Promise<unknown>)(...args)),
  ]),
) as Calls;

/** The pieces the demo reuses, so it schedules and counts exactly like the app. */
export const shared = {
  STATUSES,
  NOTE_PREFIX,
  HISTORY_DAYS,
  SETTINGS_DEFAULTS,
  newCard,
  nextCard,
  spanParts,
  streakOf,
  dayIn,
  addDays,
};
