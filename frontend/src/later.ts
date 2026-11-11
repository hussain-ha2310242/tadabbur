import { useEffect, useRef } from "react";

/** Things to do in a few seconds unless undone: a deletion waits here so it can
 *  be taken back. Whatever is still waiting runs when the screen closes or the
 *  page is left, so nothing is lost by moving on quickly. */
export function useLater(ms = 6000) {
  const waiting = useRef(new Map<string, { timer: number; run: () => void }>());

  function flush() {
    for (const [key, w] of waiting.current) {
      window.clearTimeout(w.timer);
      waiting.current.delete(key);
      w.run();
    }
  }

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    /** Run `run` after the wait, unless `cancel(key)` comes first. */
    schedule(key: string, run: () => void) {
      const old = waiting.current.get(key);
      if (old) window.clearTimeout(old.timer);
      const timer = window.setTimeout(() => {
        waiting.current.delete(key);
        run();
      }, ms);
      waiting.current.set(key, { timer, run });
    },
    /** Take it back; true when it was still waiting. */
    cancel(key: string): boolean {
      const w = waiting.current.get(key);
      if (!w) return false;
      window.clearTimeout(w.timer);
      waiting.current.delete(key);
      return true;
    },
  };
}
