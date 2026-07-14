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

const EMPTY: VisualViewportState = Object.freeze({
  height: 0,
  offsetTop: 0,
  width: 0,
  keyboardHeight: 0,
}) as VisualViewportState;

// Snapshot cache — useSyncExternalStore requires getSnapshot to return a stable
// reference between calls when the underlying values haven't changed. Returning
// a fresh object literal each time triggers React 19's infinite-loop guard and
// crashes components that consume this hook on every render.
let cached: VisualViewportState = EMPTY;
let cachedHeight = -1;
let cachedOffsetTop = -1;
let cachedWidth = -1;
let cachedKeyboard = -1;

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
  const height = vv.height;
  const offsetTop = vv.offsetTop;
  const width = vv.width;
  const keyboardHeight = Math.max(0, window.innerHeight - height);
  if (
    height === cachedHeight &&
    offsetTop === cachedOffsetTop &&
    width === cachedWidth &&
    keyboardHeight === cachedKeyboard
  ) {
    return cached;
  }
  cachedHeight = height;
  cachedOffsetTop = offsetTop;
  cachedWidth = width;
  cachedKeyboard = keyboardHeight;
  cached = { height, offsetTop, width, keyboardHeight };
  return cached;
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