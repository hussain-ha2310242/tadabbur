import type { Config } from "@netlify/functions";
import { caller, extractJson, failed, fanarChat, fail, json, str } from "../lib/server.mts";

const SYSTEM =
  "You are an Arabic dictionary and morphology reference for learners. " +
  "Return ONLY a valid JSON object with this exact shape:\n" +
  "{\n" +
  ' "meaning": "<clear concise English meaning>",\n' +
  ' "type_ar": "<فعل | اسم | حرف | صفة | ظرف>",\n' +
  ' "root": "<root letters separated by spaces, or null>",\n' +
  ' "similar": [{"word": "<vocalized Arabic word, same root or close meaning>", "meaning": "<English>"}],  // 3-5 items\n' +
  ' "conjugation": {"<Arabic form name>": "<vocalized form>"},  ' +
  "// for verbs: الماضي، المضارع، الأمر، المصدر، اسم الفاعل; " +
  "for nouns: المفرد، الجمع; empty object for particles\n" +
  ' "example": {"ar": "<short vocalized example sentence>", "en": "<translation>"}\n' +
  "}\n" +
  "All Arabic fully vocalized. No prose outside the JSON.";

/** A word's card: meaning, family, forms and an example. Made once per word
 *  and kept for everyone. */
export default async (req: Request) => {
  const c = await caller(req);
  if (c instanceof Response) return c;
  const lemmaKey = str(c.body.lemma_key, 100);
  const lemma = str(c.body.lemma, 100);
  const pos = str(c.body.pos, 40);
  const root = str(c.body.root, 40);
  if (!lemmaKey || !lemma) return fail(400, "lemma_key and lemma are required");

  try {
    if (c.cache) {
      const { data } = await c.cache.from("word_info").select("info_json").eq("lemma_key", lemmaKey).maybeSingle();
      if (data) return json(data.info_json);
    }
    let hints = pos ? ` (part of speech: ${pos})` : "";
    if (root) hints += ` (root: ${root})`;
    const info = extractJson(await fanarChat(SYSTEM, `Word: ${lemma}${hints}`, 800, 9000));
    if (!info || typeof info !== "object" || Array.isArray(info) || !("meaning" in info)) {
      return fail(502, "Fanar did not return word info - try again");
    }
    if (c.cache) await c.cache.from("word_info").upsert({ lemma_key: lemmaKey, info_json: info });
    return json(info);
  } catch (e) {
    return failed(e);
  }
};

export const config: Config = { path: "/api/enrich" };
