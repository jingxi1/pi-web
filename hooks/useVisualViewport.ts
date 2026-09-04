"use client";

import { useEffect, useState } from "react";

export interface VisualViewportState {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
}

const ZERO: VisualViewportState = { width: 0, height: 0, offsetTop: 0, offsetLeft: 0, scale: 1 };

/** SSR-safe view of window.visualViewport (drive the on-screen-keyboard inset). */
export function useVisualViewport(): VisualViewportState {
  const [port, setPort] = useState<VisualViewportState>(ZERO);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      // Fallback: whole window is the viewport.
      const syncWindow = () =>
        setPort({
          width: window.innerWidth,
          height: window.innerHeight,
          offsetTop: 0,
          offsetLeft: 0,
          scale: 1,
        });
      syncWindow();
      window.addEventListener("resize", syncWindow);
      window.addEventListener("scroll", syncWindow);
      return () => {
        window.removeEventListener("resize", syncWindow);
        window.removeEventListener("scroll", syncWindow);
      };
    }

    const sync = () =>
      setPort({
        width: vv.width,
        height: vv.height,
        offsetTop: vv.offsetTop,
        offsetLeft: vv.offsetLeft,
        scale: vv.scale,
      });
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  return port;
}
