import type { Config } from "@netlify/functions";
import { caller, dediac, extractJson, failed, fanarChat, fail, json, sha1, str } from "../lib/server.mts";

/** A word's details for a learner: what it means in the sentence it was met
 *  in (and any set phrase it is part of there), its usual meaning, its family,
 *  its forms, and two short examples in the same sense. */

const SYSTEM = `You are an expert teacher of Modern Standard Arabic writing study notes for an English-speaking learner.
You get one word: its dictionary form, how it is written in the text, and the sentence the learner met it in.

Return ONLY one JSON object, no prose, no markdown, in exactly this shape:
{
 "meaning": "<the word's usual dictionary meaning in English, 1-4 words>",
 "in_context": "<what the word as written means in THIS sentence, in English, 1-6 words>",
 "expression": {"ar": "<the set phrase or collocation it forms in this sentence, fully vocalized>", "en": "<its English meaning>"} or null,
 "type_ar": "<فعل | اسم | صفة | حرف | ظرف>",
 "root": "<root letters separated by spaces, or null>",
 "similar": [{"word": "<vocalized word>", "meaning": "<English, 1-3 words>"}],
 "conjugation": {"<Arabic form name>": "<vocalized form>"},
 "examples": [{"ar": "<sentence>", "en": "<translation>"}, {"ar": "<sentence>", "en": "<translation>"}]
}

Rules:
- in_context: read the whole sentence. Prefixes and suffixes count (بـ، لـ، و، ـه، ـها...). If the word is part of a set phrase in the sentence (like بمعزل عن، على الرغم من، أخذ يفعل), give the phrase in "expression" and let in_context reflect it. Otherwise "expression" is null.
- similar: 3 or 4 words from the same root or with a close meaning, each different from the word itself.
- conjugation: for verbs الماضي، المضارع، الأمر، المصدر، اسم الفاعل; for nouns and adjectives المفرد، الجمع; {} for particles.
- examples: exactly 2 new, natural, everyday sentences of 4 to 9 words. Each must contain the word (or its expression) in the SAME sense as in_context. Do not copy or paraphrase the given sentence. Simple vocabulary a learner can follow.
- Fully vocalize all Arabic. English is plain and short, no explanations.

Example. Input:
Word: أخذ (written: أخذ)
Sentence: أخذ الطالب يكتب الدرس بعناية.
Output:
{"meaning":"to take","in_context":"began (to)","expression":{"ar":"أَخَذَ يَفْعَلُ","en":"to begin doing"},"type_ar":"فعل","root":"أ خ ذ","similar":[{"word":"بَدَأَ","meaning":"to begin"},{"word":"شَرَعَ","meaning":"to start"},{"word":"تَنَاوَلَ","meaning":"to take, have"}],"conjugation":{"الماضي":"أَخَذَ","المضارع":"يَأْخُذُ","الأمر":"خُذْ","المصدر":"أَخْذ","اسم الفاعل":"آخِذ"},"examples":[{"ar":"أَخَذَ المَطَرُ يَهْطِلُ بِغَزَارَةٍ.","en":"The rain began to pour heavily."},{"ar":"أَخَذَتِ الطِّفْلَةُ تَضْحَكُ.","en":"The little girl began to laugh."}]}`;

type Pair = { ar: string; en: string };

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const pair = (v: unknown): Pair | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ar = text(o.ar, 200);
  const en = text(o.en, 200);
  return ar && en ? { ar, en } : null;
};

/** Keep only well-formed parts of the model's reply, in one shape. Older
 *  replies (one "example") still read the same way. */
function tidy(raw: Record<string, unknown>, word: string) {
  const examples = (Array.isArray(raw.examples) ? raw.examples : [raw.example])
    .map(pair)
    .filter((p): p is Pair => !!p)
    .slice(0, 2);
  const expression = pair(raw.expression);
  const conj: Record<string, string> = {};
  if (raw.conjugation && typeof raw.conjugation === "object" && !Array.isArray(raw.conjugation)) {
    for (const [k, v] of Object.entries(raw.conjugation as Record<string, unknown>).slice(0, 6)) {
      const t = text(v, 60);
      if (k.trim() && t) conj[k.trim().slice(0, 30)] = t;
    }
  }
  const self = dediac(word);
  const similar = (Array.isArray(raw.similar) ? raw.similar : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const w = text(o.word, 60);
      const m = text(o.meaning, 80);
      return w && m ? { word: w, meaning: m } : null;
    })
    .filter((s): s is { word: string; meaning: string } => !!s && dediac(s.word) !== self)
    .slice(0, 4);
  return {
    meaning: text(raw.meaning, 120),
    in_context: text(raw.in_context, 120) || null,
    expression,
    type_ar: text(raw.type_ar, 20) || null,
    root: text(raw.root, 40) || null,
    similar,
    conjugation: conj,
    examples,
    example: examples[0] ?? null, // for screens that show one
  };
}

/** Made once per word (and per sentence, when one is given) and kept for everyone. */
export default async (req: Request) => {
  const c = await caller(req);
  if (c instanceof Response) return c;
  const lemmaKey = str(c.body.lemma_key, 100);
  const lemma = str(c.body.lemma, 100);
  const pos = str(c.body.pos, 40);
  const root = str(c.body.root, 40);
  const written = str(c.body.word, 100) || lemma;
  const sentence = str(c.body.sentence, 600);
  if (!lemmaKey || !lemma) return fail(400, "lemma_key and lemma are required");

  // the sentence changes the answer, so it is part of the key; "v2" sets these
  // apart from the older, context-free details
  const key = `${lemmaKey}#v2${sentence ? `#${sha1(sentence).slice(0, 16)}` : ""}`;

  try {
    if (c.cache) {
      const { data } = await c.cache.from("word_info").select("info_json").eq("lemma_key", key).maybeSingle();
      if (data) return json(data.info_json);
    }
    await c.quota("enrich");
    const hints = [pos && `part of speech: ${pos}`, root && `root: ${root}`].filter(Boolean).join(", ");
    const user =
      `Word: ${lemma} (written: ${written})${hints ? ` (${hints})` : ""}\n` +
      (sentence ? `Sentence: ${sentence}` : "Sentence: (none given: describe its most common meaning, and set in_context to the same)");
    const raw = extractJson(await fanarChat(SYSTEM, user, 900, 9000));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("meaning" in raw)) {
      return fail(502, "Fanar did not return word info - try again");
    }
    const info = tidy(raw as Record<string, unknown>, lemma);
    if (!info.meaning) return fail(502, "Fanar did not return a meaning - try again");
    if (c.cache) await c.cache.from("word_info").upsert({ lemma_key: key, info_json: info });
    return json(info);
  } catch (e) {
    return failed(e);
  }
};

export const config: Config = { path: "/api/enrich" };
