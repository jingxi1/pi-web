"use client";

import { useSyncExternalStore } from "react";

export interface VisualViewportState {
  /** Visual viewport height in CSS pixels (shrinks when the on-screen keyboard opens). */
  height: number;
  /** Visual viewport top offset relative to the layout viewport. */
  offsetTop: number;
  /** Visual viewport width in CSS pixels. */
  width: number;
  /** Approximate on-screen keyboard height (innerHeight - visualViewport.height). */
  keyboardHeight: number;
}

const EMPTY: VisualViewportState = {
  height: 0,
  offsetTop: 0,
  width: 0,
  keyboardHeight: 0,
};

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.visualViewport) return () => {};
  const vv = window.visualViewport;
  vv.addEventListener("resize", cb);
  vv.addEventListener("scroll", cb);
  return () => {
    vv.removeEventListener("resize", cb);
    vv.removeEventListener("scroll", cb);
  };
}

function getSnapshot(): VisualViewportState {
  if (typeof window === "undefined" || !window.visualViewport) return EMPTY;
  const vv = window.visualViewport;
  const keyboardHeight = Math.max(0, window.innerHeight - vv.height);
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    width: vv.width,
    keyboardHeight,
  };
}

function getServerSnapshot(): VisualViewportState {
  return EMPTY;
}

/**
 * Returns the current VisualViewport state, including an approximate
 * keyboardHeight (window.innerHeight - visualViewport.height).
 *
 * Use this to lift or pad content above the on-screen keyboard on mobile.
 * SSR-safe: returns zeros on the server and first client paint.
 */
export function useVisualViewport(): VisualViewportState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
