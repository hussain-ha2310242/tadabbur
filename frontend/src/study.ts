/** The copy-prompt study flow: the app builds a prompt from a note, you paste
 *  it into Claude yourself, then paste Claude's JSON reply back. No AI call
 *  is made on this path. */

import { dediac } from "./arabic";

const HEAD = (title: string, numbered: string) =>
  "You are helping an adult learner of Modern Standard Arabic understand a text.\n\n" +
  `Text title: ${title}\n\n` +
  `Sentences (numbered):\n${numbered}\n\n`;

const SCHEMA =
  "Return ONLY one valid JSON object (no prose, no markdown fences) with this exact shape:\n" +
  "{\n" +
  '  "sentences": [{"index": 0, "en": "natural English translation of sentence 0, in context"}],\n' +
  '  "words": [{"form": "the word exactly as written in the text", ' +
  '"lemma": "dictionary form, fully vocalized", ' +
  '"pos": "noun | verb | particle | adjective | adverb | other", ' +
  '"root": "root letters separated by spaces, or null", ' +
  '"meaning": "short English meaning as used in THIS text (1-4 words)"}]\n' +
  "}\n\n" +
  "Rules:\n" +
  '- One entry in "sentences" for every numbered sentence, same index.\n' +
  '- One entry in "words" for every distinct word form in the text (skip punctuation and numbers).\n' +
  '- "form" is copied character for character from the text, with every attached letter and pronoun ' +
  "(e.g. والسيارة, بسهولة, كتبوها); forms of the same lemma get separate entries.\n" +
  '- "lemma" is the bare dictionary form: no ال, no attached prepositions, conjunctions or pronouns; ' +
  "verbs in the past tense, 3rd person masculine singular; nouns and adjectives singular.\n" +
  '- "meaning" is the sense used in this text, not every possible sense.\n' +
  '- "root" has the 3 (or 4) root letters only. Give it whenever you are confident; use null only when you are not.\n' +
  "- Output the JSON object alone.\n";

export function buildPrompt(title: string, sentences: string[]): string {
  return HEAD(title, sentences.map((s, i) => `${i}. ${s}`).join("\n")) + SCHEMA;
}

export type AnalysisWord = { lemma: string; meaning: string; root: string | null; pos: string | null };
/** forms: a written word (normalised) -> the key of its entry in words */
export type ParsedAnalysis = {
  sentences: Record<string, string>;
  words: Record<string, AnalysisWord>;
  forms?: Record<string, string>;
};

function extractJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    /* look for the object inside prose or fences */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON object found - paste the whole reply");
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Claude's reply, pasted as is (fences and prose tolerated), checked and
 *  reduced to what the reader uses. */
export function parseAnalysis(raw: string): ParsedAnalysis {
  const data = extractJson(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected a JSON object with 'sentences' and 'words'");
  }
  const d = data as { sentences?: unknown; words?: unknown };
  const sents = d.sentences ?? [];
  const words = d.words ?? [];
  if (!Array.isArray(sents) || !Array.isArray(words)) throw new Error("'sentences' and 'words' must be arrays");

  const sentences: Record<string, string> = {};
  for (const s of sents) {
    if (s && typeof s === "object" && Number.isInteger(s.index) && typeof s.en === "string" && s.en.trim()) {
      sentences[String(s.index)] = s.en.trim();
    }
  }
  const out: Record<string, AnalysisWord> = {};
  const forms: Record<string, string> = {};
  for (const w of words) {
    if (!w || typeof w !== "object") continue;
    const { form, lemma, meaning, root, pos } = w as Record<string, unknown>;
    if (typeof lemma !== "string" || !lemma.trim()) continue;
    if (typeof meaning !== "string" || !meaning.trim()) continue;
    const key = dediac(lemma).trim();
    if (!key) continue;
    const r = typeof root === "string" ? root.replace(/\./g, " ").split(/\s+/).filter(Boolean).join(" ") : "";
    out[key] = {
      lemma: lemma.trim(),
      meaning: meaning.trim(),
      root: r || null,
      pos: typeof pos === "string" ? pos : null,
    };
    if (typeof form === "string" && normal(form)) forms[normal(form)] = key;
  }
  if (!Object.keys(sentences).length && !Object.keys(out).length) {
    throw new Error("JSON had no usable 'sentences' or 'words' entries");
  }
  return { sentences, words: out, forms };
}

/** Diacritics off, and the hamza seats and alif maqsura that writers mix up made one. */
export const normal = (s: string) =>
  dediac(s)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim();

// letters that attach to the front of a word, longest first
const PREFIXES = ["وبال", "وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك", "س"];

const indexes = new WeakMap<object, Map<string, string>>();

/** The entry of `words` for a word in the text: by its lemma, by the form Claude
 *  was asked to copy, or by the word with its attached letters taken off
 *  (replies pasted before forms were asked for). Null when nothing fits. */
export function analysisKey(
  a: Pick<ParsedAnalysis, "words" | "forms"> | null | undefined,
  t: { lemma_key: string; word: string },
): string | null {
  if (!a?.words) return null;
  if (a.words[t.lemma_key]) return t.lemma_key;
  let index = indexes.get(a.words);
  if (!index) {
    index = new Map(Object.keys(a.words).map((k) => [normal(k), k]));
    indexes.set(a.words, index);
  }
  const w = normal(t.word);
  const viaForm = a.forms?.[w];
  if (viaForm && a.words[viaForm]) return viaForm;
  if (index.has(w)) return index.get(w)!;
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 2) {
      const hit = index.get(w.slice(p.length));
      if (hit) return hit;
    }
  }
  return null;
}
