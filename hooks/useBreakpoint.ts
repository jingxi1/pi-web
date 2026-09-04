"use client";

import { useSyncExternalStore } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const MQ_MOBILE = "(max-width: 767px)";
const MQ_DESKTOP = "(min-width: 1024px)";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mqMobile = window.matchMedia(MQ_MOBILE);
  const mqDesktop = window.matchMedia(MQ_DESKTOP);
  mqMobile.addEventListener?.("change", onStoreChange);
  mqDesktop.addEventListener?.("change", onStoreChange);
  return () => {
    mqMobile.removeEventListener?.("change", onStoreChange);
    mqDesktop.removeEventListener?.("change", onStoreChange);
  };
}

function getSnapshot(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(MQ_MOBILE).matches) return "mobile";
  if (window.matchMedia(MQ_DESKTOP).matches) return "desktop";
  return "tablet";
}

function getServerSnapshot(): Breakpoint {
  return "desktop";
}

/** SSR-safe current viewport breakpoint via matchMedia. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
