import { useState } from "react";
import { api } from "./api";
import { Icon } from "./icons";

// each word's audio is fetched once per visit; the server keeps it after that
const clips = new Map<string, Promise<string>>();
let player: HTMLAudioElement | null = null;

/** Read a word (or a short phrase) aloud with the reading voice. */
export async function speak(text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  let clip = clips.get(t);
  if (!clip) {
    clip = api.tts(t).then((b) => URL.createObjectURL(b));
    clips.set(t, clip);
    clip.catch(() => clips.delete(t));
  }
  const src = await clip;
  player ??= new Audio();
  player.pause();
  player.src = src;
  player.currentTime = 0;
  await player.play();
}

/** A small speaker: press it to hear the word. */
export function SpeakButton({
  text,
  onError,
  size = 14,
  className = "",
  title = "Hear it (h)",
}: {
  text: string;
  onError?: (message: string) => void;
  size?: number;
  className?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`speak-btn ${busy ? "busy" : ""} ${className}`}
      aria-label="Hear the word"
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await speak(text);
        } catch (err) {
          onError?.(String(err instanceof Error ? err.message : err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="speaker" size={size} />
    </button>
  );
}
