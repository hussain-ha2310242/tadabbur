import { useSyncExternalStore } from "react";

/** Copy a prompt, say so, and open Claude in a new tab for it to be pasted.
 *  A small card at the bottom of the screen walks through it: the clipboard
 *  turns into a tick ("copied"), a short bar fills ("opening Claude"), then
 *  Claude opens with a reminder to paste. If the browser blocks the new tab,
 *  the card offers a button for it instead. */

const CLAUDE = "https://claude.ai/new";
const COPIED_MS = 650; // how long "copied" shows before "opening"
const OPENING_MS = 650; // the bar's fill, then the tab opens
const DONE_MS = 3200; // how long the last word stays

type Phase = "copying" | "copied" | "opening" | "opened" | "blocked" | "failed";
type State = { phase: Phase; k: number } | null;

let state: State = null;
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};
let timers: number[] = [];
const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
const clearTimers = () => {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
};

/** Put text on the clipboard; falls back to the older copy command. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function openClaude(): boolean {
  const w = window.open(CLAUDE, "_blank");
  if (!w) return false;
  try {
    w.opener = null;
  } catch {
    /* some browsers already cut the link */
  }
  return true;
}

/** Copy the prompt `getPrompt` gives and hand over to Claude. Resolves to the
 *  prompt once copied (null when it could not be copied). Call it straight from
 *  a click, so the browser lets the new tab open. */
export async function copyToClaude(getPrompt: () => Promise<string>, { open = true } = {}): Promise<string | null> {
  clearTimers();
  const k = (state?.k ?? 0) + 1;
  set({ phase: "copying", k });
  let prompt: string;
  try {
    prompt = await getPrompt();
  } catch (e) {
    set(null);
    throw e;
  }
  if (!(await writeClipboard(prompt))) {
    set({ phase: "failed", k });
    later(DONE_MS, () => set(null));
    return null;
  }
  set({ phase: "copied", k });
  if (!open) {
    later(DONE_MS, () => set(null));
    return prompt;
  }
  later(COPIED_MS, () => {
    set({ phase: "opening", k });
    later(OPENING_MS, () => {
      if (openClaude()) {
        set({ phase: "opened", k });
        later(DONE_MS, () => set(null));
      } else set({ phase: "blocked", k });
    });
  });
  return prompt;
}

const paste = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘V" : "Ctrl+V");

const TEXT: Record<Phase, string> = {
  copying: "Copying the prompt…",
  copied: "Copied to clipboard",
  opening: "Opening Claude…",
  opened: "",
  blocked: "Copied. Your browser kept the new tab closed.",
  failed: "Couldn't copy the prompt. Try again?",
};

/** The card itself; render it once, near the root. */
export function ClaudeHandoff() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  if (!s) return null;
  const { phase } = s;
  const ticked = phase !== "copying" && phase !== "failed";
  const text = phase === "opened" ? `Claude is open in a new tab: paste with ${paste()}` : TEXT[phase];
  return (
    <div key={s.k} className={`handoff ph-${phase}`} role="status" aria-live="polite" dir="ltr">
      <span className="handoff-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24">
          {/* the clipboard */}
          <rect className="hf-board" x="5" y="4.5" width="14" height="16.5" rx="2.2" />
          <rect className="hf-clip" x="8.6" y="2.6" width="6.8" height="3.6" rx="1.2" />
          {/* lines of text on it, which give way to the tick */}
          <path className="hf-lines" d="M8.5 10.5h7M8.5 13.5h7M8.5 16.5h4.5" />
          <path className={`hf-tick ${ticked ? "on" : ""}`} d="M8.4 13.4l2.5 2.4 4.8-5.2" />
        </svg>
      </span>
      <span className="handoff-text">
        <span key={phase} className="handoff-line">
          {text}
        </span>
        {phase === "opening" && <span className="handoff-bar" style={{ animationDuration: `${OPENING_MS}ms` }} />}
      </span>
      {phase === "blocked" && (
        <button
          className="handoff-btn"
          onClick={() => {
            if (openClaude()) {
              set({ phase: "opened", k: s.k });
              later(DONE_MS, () => set(null));
            }
          }}
        >
          open Claude ↗
        </button>
      )}
      {(phase === "blocked" || phase === "failed") && (
        <button className="handoff-x" aria-label="Close" onClick={() => set(null)}>
          ×
        </button>
      )}
    </div>
  );
}
