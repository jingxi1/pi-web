"use client";

import { useSyncExternalStore } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

// Aligned with Tailwind v4 default breakpoints:
//   sm  = 640px  (mobile, but we use 768 as the mobile/tablet boundary)
//   md  = 768px
//   lg  = 1024px
const MOBILE_QUERY = "(max-width: 767px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1023px)";
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const queries = [MOBILE_QUERY, TABLET_QUERY, DESKTOP_QUERY].map((q) =>
    window.matchMedia(q)
  );
  queries.forEach((mql) => mql.addEventListener("change", cb));
  return () => queries.forEach((mql) => mql.removeEventListener("change", cb));
}

function getSnapshot(): Breakpoint {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

function getServerSnapshot(): Breakpoint {
  return "desktop";
}

/**
 * Returns the current breakpoint:
 *   - "mobile"  : viewport < 768px
 *   - "tablet"  : 768px ≤ viewport < 1024px
 *   - "desktop" : viewport ≥ 1024px
 *
 * SSR-safe: renders "desktop" on the server and first client paint,
 * then syncs to the real viewport after hydration. This matches the
 * existing useIsMobile() pattern (hooks/useIsMobile.ts) so consumers
 * avoid hydration mismatch warnings.
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
