import { api, type WordInfo } from "./api";
import { cleanGloss } from "./gloss";

// a word's details (its meaning here and in general, any set phrase, family,
// forms and examples), asked for once per visit and shared by every screen.
// The sentence it was met in is part of the key: it changes the answer.
const cache = new Map<string, Promise<WordInfo>>();

export type WordEntry = {
  lemma_key: string;
  lemma: string;
  pos?: string | null;
  root?: string | null;
  word?: string | null; // how it is written in the text
  sentence?: string | null; // the sentence it was met in
};

export function getWordInfo(entry: WordEntry): Promise<WordInfo> {
  const key = `${entry.lemma_key}|${entry.sentence ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = api.enrich({
      lemma_key: entry.lemma_key,
      lemma: entry.lemma,
      pos: entry.pos ?? null,
      root: entry.root ?? null,
      word: entry.word ?? null,
      sentence: entry.sentence ?? null,
    });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

// where a word was met: one sentence from your texts, found once per visit
const where = new Map<string, Promise<{ sentence: string; word: string; title: string } | null>>();
export function getContext(lemmaKey: string) {
  let p = where.get(lemmaKey);
  if (!p) {
    p = api.contextFor(lemmaKey).catch(() => null);
    where.set(lemmaKey, p);
  }
  return p;
}

/** Whether a meaning is there to show. */
export const hasMeaning = (g: string | null | undefined) => cleanGloss(g) !== "-";
