import type { Config } from "@netlify/functions";
import { caller, failed, fail, fanarSpeech, sha1, str, TTS_MODEL } from "../lib/server.mts";

/** A sentence read aloud by Fanar (Modern Standard Arabic voices). Long text is
 *  split at word boundaries, read in parallel, and joined into one wav. Each
 *  (voice, text) pair is kept in private storage, so it is paid for once. */

const VOICES = new Set(["Noor", "Huda", "Jasim", "Hamad", "Abdulrahman"]);
const CHUNK = 250;

function chunks(text: string): string[] {
  if (text.length <= CHUNK) return [text];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (cur && cur.length + 1 + word.length > CHUNK) {
      out.push(cur);
      cur = word;
    } else cur = `${cur} ${word}`.trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** Join wav files that share one format: the first file's format, every data part. */
function joinWavs(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let fmt: Uint8Array | null = null;
  const datas: Uint8Array[] = [];
  for (const p of parts) {
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    let o = 12; // after "RIFF" size "WAVE"
    while (o + 8 <= p.length) {
      const id = String.fromCharCode(p[o], p[o + 1], p[o + 2], p[o + 3]);
      let size = v.getUint32(o + 4, true);
      if (o + 8 + size > p.length) size = p.length - o - 8; // streamed wavs may leave the size open
      if (id === "fmt " && !fmt) fmt = p.subarray(o + 8, o + 8 + size);
      if (id === "data") datas.push(p.subarray(o + 8, o + 8 + size));
      o += 8 + size + (size % 2);
    }
  }
  if (!fmt) throw new Error("Fanar sent audio that is not wav");
  const dataLen = datas.reduce((n, d) => n + d.length, 0);
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + dataLen);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, out.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, fmt.length, true);
  out.set(fmt, 20);
  let o = 20 + fmt.length;
  tag(o, "data");
  v.setUint32(o + 4, dataLen, true);
  o += 8;
  for (const d of datas) {
    out.set(d, o);
    o += d.length;
  }
  return out;
}

const wav = (bytes: Uint8Array) =>
  new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=31536000, immutable" },
  });

export default async (req: Request) => {
  const c = await caller(req);
  if (c instanceof Response) return c;
  const text = str(c.body.text, 1500);
  if (!text) return fail(400, "empty text");
  const asked = str(c.body.voice, 30);
  const voice = VOICES.has(asked) ? asked : process.env.FANAR_TTS_VOICE || "Noor";
  const path = `${sha1(`${TTS_MODEL}|${voice}|${text}`)}.wav`;

  try {
    if (c.cache) {
      const { data } = await c.cache.storage.from("tts").download(path);
      if (data) return wav(new Uint8Array(await data.arrayBuffer()));
    }
    const audio = joinWavs(await Promise.all(chunks(text).map((t) => fanarSpeech(t, voice, 9000))));
    if (c.cache) {
      await c.cache.storage.from("tts").upload(path, audio, { contentType: "audio/wav", upsert: true });
    }
    return wav(audio);
  } catch (e) {
    return failed(e);
  }
};

export const config: Config = { path: "/api/tts" };
