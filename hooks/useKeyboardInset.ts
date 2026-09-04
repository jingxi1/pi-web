"use client";

import { useCallback, useEffect, useState } from "react";
import { useVisualViewport } from "./useVisualViewport";

/**
 * Estimate the on-screen-keyboard inset in px. When the visual viewport is
 * shorter than the layout viewport and pushed up, the delta is the keyboard.
 */
export function useKeyboardInset(): number {
  const port = useVisualViewport();
  const [windowHeight, setWindowHeight] = useState<number>(0);

  useEffect(() => {
    const sync = () => {
      setWindowHeight(window.innerHeight);
      if (typeof window.visualViewport === "undefined") return;
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const compute = useCallback(() => {
    if (typeof window === "undefined") return 0;
    const vv = window.visualViewport;
    if (!vv) return 0;
    const layoutHeight = window.innerHeight;
    const visible = vv.height;
    const delta = layoutHeight - visible;
    // A keyboard pushes the viewport up (offsetTop > 0); clamp small deltas.
    return delta > 24 ? Math.max(0, delta + vv.offsetTop) : 0;
  }, []);

  const [inset, setInset] = useState(0);

  useEffect(() => {
    setInset(compute());
  }, [compute, port.height, windowHeight]);

  return inset;
}
