/** What the server functions share: who is calling, the Fanar API, and the
 *  shared caches. Everything here runs on Netlify only; the keys it reads
 *  never reach the browser. */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim() ?? "";

// public values, the same as in src/supabase.ts; the environment can override them
const SUPABASE_URL = env("SUPABASE_URL", "VITE_SUPABASE_URL") || "https://cyhmgmsdqlnllsuobfcw.supabase.co";
const PUBLIC_KEY =
  env("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY") || "sb_publishable_8RYJ4NsMgU16zsSF1a8D9g_HwTZwDfT";
// optional: with it, results are cached for everyone and audio is kept
const SECRET_KEY = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");

export const FANAR_BASE = env("FANAR_BASE_URL") || "https://api.fanar.qa/v1";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

export const fail = (status: number, detail: string) => json({ detail }, status);

export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export type Caller = {
  userId: string;
  cache: SupabaseClient | null;
  body: Record<string, unknown>;
  /** Count one paid Fanar call of `kind`; throws a 429 once today's limit is used. */
  quota: (kind: Kind) => Promise<void>;
};

// a day's Fanar calls per person; each can be changed with an environment variable
type Kind = "analyze" | "translate" | "enrich" | "tts";
const LIMITS: Record<Kind, number> = {
  analyze: Number(env("LIMIT_ANALYZE")) || 300, // 16 words a call: about 4,800 new words a day
  translate: Number(env("LIMIT_TRANSLATE")) || 400,
  enrich: Number(env("LIMIT_ENRICH")) || 200,
  tts: Number(env("LIMIT_TTS")) || 300,
};

/** The signed-in caller and the request body, or the Response to send back.
 *  `cache` is a server client for the shared caches, when the secret key is set. */
export async function caller(req: Request): Promise<Caller | Response> {
  if (req.method !== "POST") return fail(405, "use POST");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail(401, "sign in first");
  const client = createClient(SUPABASE_URL, SECRET_KEY || PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return fail(401, "sign in again");
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "the request body must be JSON");
  }
  // the caller's own client: the daily count is kept against their account
  const own = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const quota = async (kind: Kind) => {
    const { data: ok, error: qerr } = await own.rpc("take_quota", { p_kind: kind, p_cap: LIMITS[kind] });
    // if the count itself fails, the call goes ahead rather than breaking the app
    if (qerr) console.warn("quota check failed:", qerr.message);
    else if (ok === false) throw new HttpError(429, "today's limit for this is used up; it resets tomorrow");
  };
  return { userId: data.user.id, cache: SECRET_KEY ? client : null, body, quota };
}

export const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function fanarKey(): string {
  const key = env("FANAR_API_KEY");
  if (!key) throw new HttpError(500, "FANAR_API_KEY is not set on Netlify");
  return key;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Turn a thrown HttpError into its response; anything else is a 502. */
export function failed(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.message);
  return fail(502, e instanceof Error ? e.message : String(e));
}

async function fanarPost(path: string, payload: unknown, timeoutMs: number): Promise<globalThis.Response> {
  return fetch(`${FANAR_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fanarKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** One chat call; the reply text, or null on any failure. Netlify stops a
 *  function after 10 seconds, so every call has a deadline below that. */
export async function fanarChat(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<string | null> {
  try {
    const r = await fanarPost(
      "/chat/completions",
      {
        model: "Fanar",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
      },
      timeoutMs,
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

/** Arabic to English with the dedicated translation model. */
export async function shaheen(text: string, timeoutMs: number): Promise<string | null> {
  try {
    const r = await fanarPost("/translations", { model: "Fanar-Shaheen-MT-1", text, langpair: "ar-en" }, timeoutMs);
    if (!r.ok) return null;
    return ((await r.json()) as { text?: string }).text ?? null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

/** Speech for one piece of text, as wav bytes. */
export async function fanarSpeech(text: string, voice: string, timeoutMs: number): Promise<Uint8Array> {
  const r = await fanarPost(
    "/audio/speech",
    { model: TTS_MODEL, voice, input: text, response_format: "wav" },
    timeoutMs,
  );
  if (!r.ok) throw new HttpError(r.status === 429 ? 429 : 502, `Fanar speech failed: ${(await r.text()).slice(0, 200)}`);
  return new Uint8Array(await r.arrayBuffer());
}

export const TTS_MODEL = "Fanar-Aura-TTS-2";

/** The first JSON object or array in a reply, or null. */
export function extractJson(content: string | null): unknown {
  if (!content) return null;
  const m = content.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ---- translation checks, as the old backend did them ----

const AR_CHARS = /[؀-ۿ]/;

export function cleanTranslation(out: string | null): string {
  let s = (out ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  s = s.replace(/^(the\s+)?(english\s+)?translation\s*(is)?\s*:?\s*/i, "");
  return s.trim();
}

/** Reject untranslated remnants, chatter, truncation and rambling. */
export function validTranslation(src: string, out: string): boolean {
  if (!out.trim() || AR_CHARS.test(out)) return false;
  const nSrc = src.split(/\s+/).filter(Boolean).length;
  const nOut = out.split(/\s+/).filter(Boolean).length;
  if (nOut > Math.max(8, nSrc * 4)) return false;
  if (nOut < Math.max(1, Math.floor(nSrc / 6))) return false;
  const low = out.toLowerCase();
  return !["here is", "sure", "i'm sorry", "i cannot", "as an ai"].some((p) => low.startsWith(p));
}

/** Diacritics and tatweel removed, as CAMeL's dediac_ar does. */
export const dediac = (s: string) => s.replace(/[ً-ْٰـ]/g, "");
