"use client";

import { useCallback, useRef, useState } from "react";

interface TouchPoint {
  x: number;
  y: number;
  t: number;
}

interface Options {
  /** Distance in px to trigger dismiss (default 80). */
  threshold?: number;
  /** Minimum velocity (px/ms) to trigger dismiss (default 0.6). */
  velocity?: number;
  /** Primary drag axis: "x" dismisses on horizontal swipe (default). */
  axis?: "x" | "y";
  /** Callback fired when the gesture commits. */
  onDismiss: () => void;
}

/**
 * Detect a fast swipe along a primary axis and fire onDismiss. Handlers are
 * plain React touch props; commonly spread onto the container being closed.
 */
export function useSwipeDismiss({ onDismiss, threshold = 80, velocity = 0.6, axis = "x" }: Options) {
  const start = useRef<TouchPoint | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      setDismissing(false);
    },
    []
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    const dist = axis === "x" ? dx : dy;
    // Ignore gestures that look mostly like scrolling the other axis.
    const other = Math.abs(axis === "x" ? dy : dx);
    if (other > Math.abs(dist)) return;
    setDismissing(Math.abs(dist) > threshold * 0.6);
  }, [axis, threshold]);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dist = axis === "x" ? t.clientX - s.x : t.clientY - s.y;
      const dt = Date.now() - s.t || 1;
      const speed = Math.abs(dist) / dt;
      if ((Math.abs(dist) > threshold && Math.abs(dist) > Math.abs(t.clientY - s.y)) || speed > velocity) {
        onDismiss();
      }
      setDismissing(false);
    },
    [axis, threshold, velocity, onDismiss]
  );

  return { onTouchStart, onTouchMove, onTouchEnd, dismissing };
}
