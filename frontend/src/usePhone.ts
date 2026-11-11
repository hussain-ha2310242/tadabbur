import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** A phone-width screen: the layouts that keep controls low, within thumb reach. */
export const PHONE = "(max-width: 640px)";

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Docks fixed to the bottom of the screen. Each keeps its height here and the
 *  page's --dock-h is the tallest of them, so the page's foot, toasts and the
 *  demo bar sit above whatever dock is showing, whichever mounts or unmounts first. */
const docks = new Map<symbol, number>();
function publish() {
  const h = Math.max(0, ...docks.values());
  if (h) document.documentElement.style.setProperty("--dock-h", `${h}px`);
  else document.documentElement.style.removeProperty("--dock-h");
}

/** A dock fixed to the bottom of the screen: keeps --dock-h at its height
 *  (with its gap from the screen's edge). Returns that height. */
export function useDockHeight(ref: RefObject<HTMLElement | null>, on: boolean): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const id = Symbol("dock");
    const set = () => {
      const v = Math.ceil(el.getBoundingClientRect().height + (parseFloat(getComputedStyle(el).bottom) || 0));
      setH(v);
      docks.set(id, v);
      publish();
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      docks.delete(id);
      publish();
    };
  }, [on, ref]);
  return h;
}
