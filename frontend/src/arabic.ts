/** Splitting a text into sentences and tokens, in the browser. The analysis
 *  of each word (lemma, root, meaning) comes from the server's Fanar call. */

export type Token = {
  word: string;
  diac: string;
  lemma: string;
  lemma_key: string; // the dediacritised lemma: the key for your level of a word
  root: string | null;
  pos: string | null; // "punc" and "digit" are not words to learn
  gloss: string | null;
};

export type Sentence = { text: string; tokens: Token[] };

/** Diacritics and tatweel removed, as CAMeL's dediac_ar does. */
export const dediac = (s: string) => s.replace(/[ً-ْٰـ]/g, "");

const SENT_SPLIT = /(?<=[.!؟…])\s+|\n+/;

export function splitSentences(body: string): string[] {
  return body
    .split(SENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

// letters with their marks, digits, or one other non-space character
const TOKEN = /[\p{L}\p{M}ـ]+|\p{N}+|[^\s\p{L}\p{M}\p{N}]/gu;
const LETTERS = /\p{L}/u;
const DIGITS = /^\p{N}+$/u;

export const isWord = (t: Token) => !!t.lemma_key && t.pos !== "punc" && t.pos !== "digit";

/** A token before analysis: the word stands for its own lemma. */
export function rawToken(word: string): Token {
  const pos = DIGITS.test(word) ? "digit" : LETTERS.test(word) ? null : "punc";
  const key = pos ? word : dediac(word);
  return { word, diac: word, lemma: word, lemma_key: key, root: null, pos, gloss: null };
}

export function tokenize(sentence: string): Token[] {
  return (sentence.match(TOKEN) ?? []).map(rawToken);
}

/** The distinct words (lemma keys) in a text. */
export function wordKeys(sentences: Sentence[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sentences) for (const t of s.tokens) if (isWord(t)) keys.add(t.lemma_key);
  return keys;
}
