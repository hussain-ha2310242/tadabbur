import type { Config } from "@netlify/functions";
import { caller, dediac, extractJson, failed, fanarChat, fail, json } from "../lib/server.mts";

/** How a word reads: its dictionary form, root, part of speech, meaning, and
 *  the word itself with its vowels. Replaces the CAMeL Tools step of the old
 *  backend. Each written form is analysed once and kept for everyone. */
type Form = { lemma: string; root: string | null; pos: string | null; gloss: string | null; diac: string };

const MAX_WORDS = 16; // one call stays well inside Netlify's 10 second limit

const POS = new Set(["noun", "verb", "adj", "adv", "pron", "prep", "conj", "part", "propn", "num"]);

const SYSTEM =
  "You are an Arabic morphological analyser for learners of Modern Standard Arabic. " +
  "You get numbered Arabic words exactly as they appear in a text (they may carry prefixes such as " +
  "و ف ب ك ل ال س and attached pronouns). For each one give:\n" +
  '- "lemma": the dictionary form, fully vocalized (verbs: past tense, 3rd person masculine singular; ' +
  "nouns and adjectives: singular, without ال, prefixes or attached pronouns)\n" +
  '- "root": the root letters separated by spaces, or null for particles and foreign names\n' +
  '- "pos": one of noun, verb, adj, adv, pron, prep, conj, part, propn, num\n' +
  '- "gloss": the most common English meaning of the lemma, 1-3 words\n' +
  '- "diac": the word exactly as given, fully vocalized as it is most likely read\n' +
  'Return ONLY a JSON array: [{"i": 0, "lemma": "...", "root": "...", "pos": "...", "gloss": "...", "diac": "..."}]. ' +
  "One entry per word, same numbers. No prose.";

const ARABIC = /[ء-ي]/;

function cleanForm(word: string, raw: unknown): Form | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lemma = typeof r.lemma === "string" ? r.lemma.trim() : "";
  if (!ARABIC.test(lemma) || lemma.length > 40) return null;
  let root = typeof r.root === "string" ? r.root.replace(/[^ء-ي]+/g, " ").trim() : "";
  // "كتب" comes back as well as "ك ت ب": space it out
  if (root && !root.includes(" ")) root = [...root].join(" ");
  const pos = typeof r.pos === "string" && POS.has(r.pos.trim().toLowerCase()) ? r.pos.trim().toLowerCase() : null;
  const gloss = typeof r.gloss === "string" && r.gloss.trim() && !ARABIC.test(r.gloss) ? r.gloss.trim().slice(0, 60) : null;
  // the vowelled word must still be the same word
  const diac = typeof r.diac === "string" && dediac(r.diac.trim()) === dediac(word) ? r.diac.trim() : word;
  return { lemma, root: root || null, pos, gloss, diac };
}

export default async (req: Request) => {
  const c = await caller(req);
  if (c instanceof Response) return c;
  const words = Array.isArray(c.body.words)
    ? [...new Set(c.body.words.filter((w): w is string => typeof w === "string").map((w) => w.trim()))]
        .filter((w) => w && w.length <= 40 && ARABIC.test(w))
    : [];
  if (!words.length) return fail(400, "no Arabic words given");
  if (words.length > MAX_WORDS) return fail(400, `at most ${MAX_WORDS} words per call`);

  try {
    const forms: Record<string, Form> = {};
    if (c.cache) {
      const { data } = await c.cache.from("word_forms").select("form, info").in("form", words);
      for (const row of data ?? []) forms[row.form as string] = row.info as Form;
    }
    const missing = words.filter((w) => !forms[w]);
    if (missing.length) {
      const list = missing.map((w, i) => `${i}. ${w}`).join("\n");
      const reply = extractJson(await fanarChat(SYSTEM, list, 90 * missing.length + 200, 8500));
      const fresh: { form: string; info: Form }[] = [];
      if (Array.isArray(reply)) {
        reply.forEach((item, pos) => {
          const i = item && typeof item === "object" && Number.isInteger((item as { i?: unknown }).i) ? (item as { i: number }).i : pos;
          const word = missing[i];
          const form = word ? cleanForm(word, item) : null;
          if (word && form && !forms[word]) {
            forms[word] = form;
            fresh.push({ form: word, info: form });
          }
        });
      }
      if (fresh.length && c.cache) await c.cache.from("word_forms").upsert(fresh, { ignoreDuplicates: true });
    }
    return json({ forms });
  } catch (e) {
    return failed(e);
  }
};

export const config: Config = { path: "/api/analyze" };
