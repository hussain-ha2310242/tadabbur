import { api, type WordInfo } from "./api";
import { cleanGloss } from "./gloss";

// a word's details (meaning, root, similar words, forms, example), asked for
// once per visit and shared by every screen that needs them
const cache = new Map<string, Promise<WordInfo>>();

export function getWordInfo(entry: { lemma_key: string; lemma: string; pos?: string | null; root?: string | null }): Promise<WordInfo> {
  let p = cache.get(entry.lemma_key);
  if (!p) {
    p = api.enrich({ lemma_key: entry.lemma_key, lemma: entry.lemma, pos: entry.pos ?? null, root: entry.root ?? null });
    cache.set(entry.lemma_key, p);
    p.catch(() => cache.delete(entry.lemma_key));
  }
  return p;
}

/** Whether a meaning is there to show. */
export const hasMeaning = (g: string | null | undefined) => cleanGloss(g) !== "-";
