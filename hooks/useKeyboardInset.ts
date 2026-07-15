"use client";

import { useEffect, useState } from "react";

const FALLBACK_HEIGHT = 0;

/**
 * Returns the height of the on-screen keyboard in CSS pixels, or 0 when no
 * keyboard is visible. Uses `window.visualViewport` which is the only API
 * that gives a stable reading across iOS Safari's address-bar collapse.
 *
 * SSR-safe: returns 0 on the server and on the first client paint, then
 * syncs to the real value after hydration.
 */
export function useKeyboardInset(): number {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(FALLBACK_HEIGHT);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // visualViewport.height shrinks when the keyboard appears; innerHeight
      // stays the same. The delta is the keyboard's height.
      const inset = Math.max(0, window.innerHeight - vv.height);
      setKeyboardHeight(inset);
    };
    update();

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return keyboardHeight;
}
