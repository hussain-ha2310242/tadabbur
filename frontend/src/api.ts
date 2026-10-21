export type Token = {
  word: string;
  diac: string;
  lemma: string;
  lemma_key: string;
  root: string | null;
  pos: string | null;
  gloss: string | null;
};

export type Sentence = { text: string; tokens: Token[] };

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

/** Claude-produced study data for a note (see routers/study.py). */
export type Analysis = {
  sentences: Record<string, string>; // sentence index -> English
  words: Record<string, { lemma: string; meaning: string; root: string | null; pos: string | null }>;
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
  id: number;
  name: string;
  timezone: string;
  joined: string | null;
  today: string;
  streak: Streak;
  days: DayActivity[]; // the last 12 weeks, oldest first, one entry per day
  totals: { words: number; known: number; learning: number; texts: number; reviews: number };
};

/** A word in the wallet. */
export type WalletWord = DueWord & { created_at: string | null };

/** Content is shown with plain hyphens: no em dashes reach the screen. */
function plain<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\u2014/g, "-") as unknown as T;
  if (Array.isArray(v)) return v.map((x) => plain(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === "lemma_key" ? x : plain(x);
    return o as T;
  }
  return v;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return plain(await res.json());
}

export const api = {
  listTexts: () => req<TextSummary[]>("/api/texts"),
  getText: (id: number) => req<TextDetail>(`/api/texts/${id}`),
  createText: (
    title: string,
    body: string,
    importance = 2,
    glosses: "fanar" | "none" = "fanar",
    origin: { source?: string; url?: string } = {},
  ) =>
    req<{ id: number }>("/api/texts", {
      method: "POST",
      body: JSON.stringify({ title, body, importance, glosses, ...origin }),
    }),
  setTextTitle: (id: number, title: string) =>
    req<{ id: number; title: string }>(`/api/texts/${id}/title`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  setTextSource: (id: number, source: string, url: string) =>
    req<{ id: number; source: string | null; url: string | null }>(`/api/texts/${id}/source`, {
      method: "PUT",
      body: JSON.stringify({ source, url }),
    }),
  setImportance: (id: number, importance: number) =>
    req(`/api/texts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ importance }),
    }),
  deleteText: (id: number) =>
    req<{ ok: boolean }>(`/api/texts/${id}`, { method: "DELETE" }),

  addVocab: (entry: {
    lemma_key: string;
    display: string;
    root?: string | null;
    pos?: string | null;
    gloss?: string | null;
    notes?: string | null;
    is_phrase?: boolean;
    status?: string;
    importance?: number;
  }) => req("/api/vocab", { method: "POST", body: JSON.stringify(entry) }),
  updateVocab: (lemmaKey: string, patch: { status?: string; importance?: number; notes?: string }) =>
    req(`/api/vocab/${encodeURIComponent(lemmaKey)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listWords: () => req<WalletWord[]>("/api/vocab"),

  listNotes: () => req<Annotation[]>("/api/annotations"),
  createNote: (n: { text_id: number; start_si: number; start_ti: number; end_si: number; end_ti: number; comment: string }) =>
    req<Annotation>("/api/annotations", { method: "POST", body: JSON.stringify(n) }),
  updateNote: (id: number, patch: { comment?: string; status?: string }) =>
    req<Annotation>(`/api/annotations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteNote: (id: number) => req<{ ok: boolean }>(`/api/annotations/${id}`, { method: "DELETE" }),

  getProfile: () => req<Profile>("/api/profile"),
  updateProfile: (patch: { name?: string; timezone?: string }) =>
    req<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(patch) }),

  listTags: () => req<TagWithCount[]>("/api/tags"),
  setTextTags: (id: number, names: string[]) =>
    req<{ tags: string[] }>(`/api/texts/${id}/tags`, {
      method: "PUT",
      body: JSON.stringify({ names }),
    }),

  getPrompt: (id: number) => req<{ prompt: string; sentences: number }>(`/api/texts/${id}/prompt`),
  // the prompt for a note that is not saved yet; nothing is written
  previewPrompt: (title: string, body: string) =>
    req<{ prompt: string; sentences: number }>("/api/prompt_preview", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }),
  importAnalysis: (id: number, raw: string) =>
    req<{ sentences: number; words: number }>(`/api/texts/${id}/analysis`, {
      method: "POST",
      body: JSON.stringify({ raw }),
    }),
  saveOverride: (lemmaKey: string, patch: { gloss: string | null; root: string | null }) =>
    req<{ lemma_key: string; gloss: string | null; root: string | null }>(
      `/api/overrides/${encodeURIComponent(lemmaKey)}`,
      { method: "PUT", body: JSON.stringify(patch) },
    ),
  clearAnalysis: (id: number) =>
    req<{ ok: boolean }>(`/api/texts/${id}/analysis`, { method: "DELETE" }),

  // several tags and notes at once: the union of their words (empty = everything)
  dueWords: (scope?: { tagIds?: number[]; textIds?: number[] }) => {
    const q = new URLSearchParams();
    if (scope?.tagIds?.length) q.set("tag_ids", scope.tagIds.join(","));
    if (scope?.textIds?.length) q.set("text_ids", scope.textIds.join(","));
    const qs = q.toString();
    return req<DueWord[]>(`/api/review/due${qs ? `?${qs}` : ""}`);
  },
  grade: (lemmaKey: string, status: string) =>
    req("/api/review/grade", {
      method: "POST",
      body: JSON.stringify({ lemma_key: lemmaKey, status }),
    }),

  ttsUrl: (text: string) => `/api/audio/tts?text=${encodeURIComponent(text)}`,

  markAllKnown: (id: number) =>
    req<{ marked: number }>(`/api/texts/${id}/mark_all_known`, { method: "POST" }),
  enrich: (entry: { lemma_key: string; lemma: string; pos?: string | null; root?: string | null }) =>
    req<WordInfo>("/api/enrich", { method: "POST", body: JSON.stringify(entry) }),
  translate: (text: string, context?: string) =>
    req<{ translation: string }>("/api/translate", {
      method: "POST",
      body: JSON.stringify({ text, context }),
    }),
  getSettings: () => req<Settings>("/api/settings"),
  saveSettings: (values: Settings) =>
    req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify({ values }) }),
};
