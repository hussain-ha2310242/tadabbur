import type { Config } from "@netlify/functions";
import { caller, cleanTranslation, failed, fanarChat, fail, json, sha1, shaheen, str, validTranslation } from "../lib/server.mts";

const SYSTEM =
  "You are a professional Arabic-to-English translator. Translate the " +
  "given sentence into natural, accurate English. Use the context only " +
  "to resolve ambiguity - translate ONLY the sentence itself. Output the " +
  "English translation alone: no quotes, no notes, no explanations, no " +
  "transliteration.";

/** Context-aware translation: the chat model first (it reads the context),
 *  the translation model as fallback, and only checked output is returned.
 *  `lenient` (a selection's meaning) answers null instead of failing. */
export default async (req: Request) => {
  const c = await caller(req);
  if (c instanceof Response) return c;
  const text = str(c.body.text);
  const context = str(c.body.context, 3000);
  const lenient = c.body.lenient === true;
  if (!text) return fail(400, "empty text");

  try {
    // sentences are cached for everyone; a selection's meaning depends on its context
    const key = sha1(`v2|${text}`);
    if (!lenient && c.cache) {
      const { data } = await c.cache.from("translations").select("translation").eq("key", key).maybeSingle();
      if (data) return json({ translation: data.translation });
    }

    const user = context ? `Context: ${context}\n\nSentence: ${text}` : `Sentence: ${text}`;
    let out = cleanTranslation(await fanarChat(SYSTEM, user, 500, 6000));
    if (!validTranslation(text, out)) out = cleanTranslation(await shaheen(text, 3200));
    if (!validTranslation(text, out)) {
      return lenient ? json({ translation: null }) : fail(502, "no valid translation produced - try again");
    }

    if (!lenient && c.cache) await c.cache.from("translations").upsert({ key, translation: out });
    return json({ translation: out });
  } catch (e) {
    return lenient ? json({ translation: null }) : failed(e);
  }
};

export const config: Config = { path: "/api/translate" };
