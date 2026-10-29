/** The try-it demo: one short article, already analysed, and every call the
 *  screens make answered in memory. Nothing reaches Supabase or Fanar, and
 *  nothing is kept after the tab closes. */

import { setBackend, shared, type Annotation, type Calls, type DueWord, type Settings, type TextSummary, type WalletWord } from "./api";
import { isWord, splitSentences, wordKeys, type Sentence, type Token } from "./arabic";
import { article, BODY, SENTENCES_EN, TITLE } from "./sample";
import { analysisKey, buildPrompt, parseAnalysis, type ParsedAnalysis } from "./study";

export const DEMO_ONLY = "That works once you sign up. It's free.";

type Word = WalletWord & { card_json: unknown };
type Note = Annotation & { card_json: unknown };

type State = {
  title: string;
  source: string | null;
  url: string | null;
  importance: number;
  sentences: Sentence[];
  analysis: ParsedAnalysis | null;
  tags: string[];
  words: Map<string, Word>;
  notes: Note[];
  overrides: Record<string, { gloss: string | null; root: string | null }>;
  settings: Settings;
  days: Map<string, { reviews: number; marks: number; texts: number }>;
  name: string;
  created: string;
};

const TEXT_ID = 1;
const TAG_ID = 1;
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Qatar";
let state: State;

function tokenAt(si: number, ti: number): Token | undefined {
  return state.sentences[si]?.tokens[ti];
}

function fresh(): State {
  const sentences = article();
  const now = new Date().toISOString();
  const words = new Map<string, Word>();
  const add = (si: number, ti: number, status: string) => {
    const t = sentences[si].tokens[ti];
    words.set(t.lemma_key, {
      lemma_key: t.lemma_key,
      display: t.lemma,
      is_phrase: 0,
      root: t.root,
      pos: t.pos,
      gloss: t.gloss,
      notes: null,
      importance: 0,
      status,
      ...(status === "known" ? { card_json: null, due: null } : shared.newCard()),
      created_at: now,
    });
  };
  // a few words already marked, so the progress bar and the deck have something in them
  add(0, 4, "known"); // المكتبة
  add(1, 4, "known"); // كتابا
  add(0, 7, "known"); // بيتي
  add(0, 2, "known"); // اليوم
  add(0, 0, "easy"); // ذهبت
  add(1, 2, "hard"); // النافذة
  add(1, 6, "not_known"); // تاريخ
  add(2, 2, "not_known"); // هادئا
  const s: State = {
    title: TITLE,
    source: "a Tadabbur sample",
    url: null,
    importance: 2,
    sentences,
    analysis: { sentences: { ...SENTENCES_EN }, words: {}, forms: {} },
    tags: ["sample"],
    words,
    notes: [],
    overrides: {},
    settings: { ...shared.SETTINGS_DEFAULTS },
    days: new Map(),
    name: "Guest",
    created: now,
  };
  state = s;
  // a phrase already kept, with a note: بجانب النافذة
  s.notes.push(makeNote(1, 1, 1, 2, "a handy way to say 'next to'"));
  return s;
}

function quoteOf(a: [number, number], b: [number, number]): { quote: string; meaning: string } {
  const words: string[] = [];
  const glosses: string[] = [];
  for (let si = a[0]; si <= b[0]; si++) {
    const toks = state.sentences[si].tokens;
    const lo = si === a[0] ? a[1] : 0;
    const hi = si === b[0] ? b[1] : toks.length - 1;
    for (const t of toks.slice(lo, hi + 1)) {
      words.push(t.word);
      if (isWord(t) && t.gloss) glosses.push(t.gloss.split(/[;,]/)[0].trim());
    }
  }
  return { quote: words.join(" ").trim(), meaning: glosses.join(" ") };
}

let nextNoteId = 1;
function makeNote(ssi: number, sti: number, esi: number, eti: number, comment: string): Note {
  const { quote, meaning } = quoteOf([ssi, sti], [esi, eti]);
  return {
    id: nextNoteId++,
    text_id: TEXT_ID,
    start_si: ssi,
    start_ti: sti,
    end_si: esi,
    end_ti: eti,
    quote,
    meaning,
    comment,
    status: "not_known",
    created_at: new Date().toISOString(),
    ...shared.newCard(),
  };
}

function log(kind: "reviews" | "marks" | "texts") {
  const day = shared.dayIn(tz);
  const d = state.days.get(day) ?? { reviews: 0, marks: 0, texts: 0 };
  d[kind] += 1;
  state.days.set(day, d);
}

const strip = <T extends { card_json?: unknown }>(x: T) => {
  const { card_json: _c, ...rest } = x;
  void _c;
  return rest;
};

const noteOut = (n: Note, title?: string): Annotation => ({ ...strip(n), ...(title !== undefined ? { title } : {}) });

function counts() {
  const by: Record<string, number> = {};
  let phrases = 0;
  for (const w of state.words.values()) {
    if (w.is_phrase) phrases++;
    else by[w.status] = (by[w.status] ?? 0) + 1;
  }
  return { by, phrases };
}

function streakNow() {
  const active = new Set([...state.days].filter(([, d]) => d.reviews + d.marks + d.texts > 0).map(([day]) => day));
  return shared.streakOf(active, shared.dayIn(tz));
}

const later = async (): Promise<never> => {
  throw new Error(DEMO_ONLY);
};

const demoCalls: Calls = {
  listTexts: async (): Promise<TextSummary[]> => {
    const keys = wordKeys(state.sentences);
    const known = [...keys].filter((k) => state.words.get(k)?.status === "known").length;
    return [
      {
        id: TEXT_ID,
        title: state.title,
        importance: state.importance,
        created_at: state.created,
        sentences: state.sentences.length,
        words: keys.size,
        to_learn: keys.size - known,
        excerpt: BODY.replace(/\s+/g, " ").slice(0, 160),
        tags: state.tags.map((name) => ({ id: TAG_ID, name })),
        has_analysis: !!state.analysis,
        source: state.source,
        url: state.url,
      },
    ];
  },
  getText: async (id) => {
    if (id !== TEXT_ID) throw new Error("404: text not found");
    const statuses: Record<string, string> = {};
    for (const k of wordKeys(state.sentences)) {
      const w = state.words.get(k);
      if (w) statuses[k] = w.status;
    }
    return {
      id: TEXT_ID,
      title: state.title,
      source: state.source,
      url: state.url,
      sentences: state.sentences,
      statuses,
      overrides: { ...state.overrides },
      tags: state.tags.map((name) => ({ id: TAG_ID, name })),
      annotations: [...state.notes].sort((a, b) => a.start_si - b.start_si || a.start_ti - b.start_ti).map((n) => noteOut(n)),
      analysis: state.analysis,
    };
  },
  createText: later,
  reanalyze: later,
  setTextTitle: async (id, title) => {
    const t = title.split(/\s+/).filter(Boolean).join(" ").slice(0, 200);
    if (!t) throw new Error("the title cannot be empty");
    state.title = t;
    return { id, title: t };
  },
  setTextSource: async (id, source, url) => {
    const u = url.trim() || null;
    if (u && !/^https?:\/\/\S+$/i.test(u)) throw new Error("the link must start with http:// or https://");
    state.source = source.trim() || null;
    state.url = u;
    return { id, source: state.source, url: state.url };
  },
  setImportance: async (id, importance) => {
    state.importance = importance;
    return { id, importance };
  },
  deleteText: later,
  addVocab: async (entry) => {
    const status = entry.status ?? "not_known";
    const key = entry.lemma_key.replace(/[ً-ْٰـ]/g, "").trim();
    const have = state.words.get(key);
    if (have) have.status = status;
    else {
      state.words.set(key, {
        lemma_key: key,
        display: entry.display,
        is_phrase: entry.is_phrase ? 1 : 0,
        root: entry.root ?? null,
        pos: entry.pos ?? null,
        gloss: entry.gloss ?? null,
        notes: entry.notes ?? null,
        importance: entry.importance ?? 0,
        status,
        created_at: new Date().toISOString(),
        ...shared.newCard(),
      });
    }
    log("marks");
    return { lemma_key: key, status, gloss: entry.gloss ?? null };
  },
  updateVocab: async (lemmaKey, patch) => {
    const w = state.words.get(lemmaKey);
    if (!w) throw new Error("404: word not in wallet");
    if (patch.status !== undefined) w.status = patch.status;
    if (patch.importance !== undefined) w.importance = patch.importance;
    if (patch.notes !== undefined) w.notes = patch.notes;
    if (patch.status !== undefined) log("marks");
    return { lemma_key: lemmaKey, ok: true };
  },
  listWords: async () => [...state.words.values()].reverse().map((w) => strip(w) as WalletWord),
  listNotes: async () => [...state.notes].reverse().map((n) => noteOut(n, state.title)),
  createNote: async (n) => {
    let a: [number, number] = [n.start_si, n.start_ti];
    let b: [number, number] = [n.end_si, n.end_ti];
    if (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1])) [a, b] = [b, a];
    if (!tokenAt(a[0], a[1]) || !tokenAt(b[0], b[1])) throw new Error("the selection is outside the text");
    const note = makeNote(a[0], a[1], b[0], b[1], (n.comment ?? "").trim().slice(0, 2000));
    state.notes.push(note);
    log("marks");
    return noteOut(note);
  },
  updateNote: async (id, patch) => {
    const n = state.notes.find((x) => x.id === id);
    if (!n) throw new Error("404: note not found");
    if (patch.comment !== undefined) n.comment = patch.comment.trim().slice(0, 2000);
    if (patch.status !== undefined) {
      n.status = patch.status;
      log("marks");
    }
    return noteOut(n);
  },
  deleteNote: async (id) => {
    state.notes = state.notes.filter((x) => x.id !== id);
    return { ok: true };
  },
  getProfile: async () => {
    const today = shared.dayIn(tz);
    const start = shared.addDays(today, -(shared.HISTORY_DAYS - 1));
    const { by } = counts();
    return {
      id: "demo",
      name: state.name,
      timezone: tz,
      joined: state.created,
      today,
      streak: streakNow(),
      days: Array.from({ length: shared.HISTORY_DAYS }, (_, i) => {
        const day = shared.addDays(start, i);
        const d = state.days.get(day);
        return { day, reviews: d?.reviews ?? 0, marks: d?.marks ?? 0, texts: d?.texts ?? 0 };
      }),
      totals: {
        words: Object.values(by).reduce((a, b) => a + b, 0),
        known: by.known ?? 0,
        learning: (by.not_known ?? 0) + (by.hard ?? 0) + (by.easy ?? 0),
        texts: 1,
        reviews: [...state.days.values()].reduce((a, d) => a + d.reviews, 0),
      },
    };
  },
  updateProfile: async (patch) => {
    if (patch.name !== undefined) state.name = patch.name.trim().slice(0, 60) || state.name;
    return demoCalls.getProfile();
  },
  stats: async () => {
    const { by, phrases } = counts();
    const now = Date.now();
    const due = (x: { status: string; due: string | null }) => x.status !== "known" && (!x.due || Date.parse(x.due) <= now);
    return {
      known: by.known ?? 0,
      learning: (by.not_known ?? 0) + (by.hard ?? 0) + (by.easy ?? 0),
      hard: by.hard ?? 0,
      easy: by.easy ?? 0,
      phrases,
      due: [...state.words.values()].filter(due).length + state.notes.filter(due).length,
      texts: 1,
      streak: streakNow(),
      name: state.name,
    };
  },
  listTags: async () => state.tags.map((name) => ({ id: TAG_ID, name, notes: 1 })),
  setTextTags: async (_id, names) => {
    state.tags = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    return { tags: state.tags };
  },
  getPrompt: async () => ({ prompt: buildPrompt(state.title, splitSentences(BODY)), sentences: state.sentences.length }),
  previewPrompt: later,
  importAnalysis: async (_id, raw) => {
    const a = parseAnalysis(raw);
    state.analysis = a;
    for (const s of state.sentences)
      for (const t of s.tokens) {
        const k = t.pos === null ? analysisKey(a, t) : null;
        const w = k ? a.words[k] : undefined;
        if (k && w) Object.assign(t, { lemma: w.lemma, lemma_key: k, root: w.root, pos: w.pos ?? "other", gloss: w.meaning });
      }
    return { sentences: Object.keys(a.sentences).length, words: Object.keys(a.words).length };
  },
  saveOverride: async (lemmaKey, patch) => {
    const gloss = (patch.gloss ?? "").trim() || null;
    const root = (patch.root ?? "").replace(/\./g, " ").split(/\s+/).filter(Boolean).join(" ") || null;
    if (gloss === null && root === null) delete state.overrides[lemmaKey];
    else state.overrides[lemmaKey] = { gloss, root };
    const w = state.words.get(lemmaKey);
    if (w && gloss !== null) w.gloss = gloss;
    if (w && root !== null) w.root = root;
    return { lemma_key: lemmaKey, gloss, root };
  },
  clearAnalysis: async () => {
    state.analysis = null;
    return { ok: true };
  },
  dueWords: async () => {
    const now = Date.now();
    const isDue = (x: { status: string; due: string | null }) => x.status !== "known" && (!x.due || Date.parse(x.due) <= now);
    const words: DueWord[] = [...state.words.values()].filter(isDue).map((w) => {
      const { created_at: _c, ...rest } = strip(w);
      void _c;
      return rest;
    });
    const notes: DueWord[] = state.notes.filter(isDue).map((n) => ({
      lemma_key: `${shared.NOTE_PREFIX}${n.id}`,
      display: n.quote,
      is_phrase: 1,
      root: null,
      pos: null,
      gloss: n.meaning ?? "",
      comment: n.comment,
      notes: state.title,
      importance: 0,
      status: n.status,
      due: n.due,
      kind: "note" as const,
      ...shared.spanParts(state.sentences, n),
    }));
    return [...words, ...notes];
  },
  grade: async (lemmaKey, status) => {
    const isNote = lemmaKey.startsWith(shared.NOTE_PREFIX);
    const item = isNote ? state.notes.find((n) => `${shared.NOTE_PREFIX}${n.id}` === lemmaKey) : state.words.get(lemmaKey);
    if (!item) throw new Error("404: not found");
    const { card_json, due } = shared.nextCard(item.card_json, status);
    Object.assign(item, { status, card_json, due });
    log("reviews");
    return { lemma_key: lemmaKey, status, due };
  },
  tts: later,
  markAllKnown: async () => {
    let marked = 0;
    for (const s of state.sentences)
      for (const t of s.tokens) {
        if (!isWord(t)) continue;
        const w = state.words.get(t.lemma_key);
        if (w) w.status = "known";
        else {
          state.words.set(t.lemma_key, {
            lemma_key: t.lemma_key, display: t.lemma, is_phrase: 0, root: t.root, pos: t.pos, gloss: t.gloss,
            notes: null, importance: 0, status: "known", card_json: null, due: null, created_at: new Date().toISOString(),
          });
        }
        marked++;
      }
    log("marks");
    return { marked };
  },
  enrich: later,
  translate: async (text) => {
    const i = state.sentences.findIndex((s) => s.text === text);
    if (i >= 0 && SENTENCES_EN[String(i)]) return { translation: SENTENCES_EN[String(i)] };
    return later();
  },
  getSettings: async () => ({ ...state.settings }),
  saveSettings: async (values) => {
    state.settings = { ...state.settings, ...values };
    return { ...state.settings };
  },
};

// ---- on and off: the gate shows the app with a demo bar while this is on ----

let on = false;
const listeners = new Set<(on: boolean) => void>();

export const isDemo = () => on;

export function onDemoChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function startDemo() {
  fresh();
  setBackend(demoCalls);
  on = true;
  listeners.forEach((cb) => cb(true));
}

export function stopDemo() {
  setBackend(null);
  on = false;
  listeners.forEach((cb) => cb(false));
}
