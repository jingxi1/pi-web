"use client";

import { useRef, useState, useCallback, useEffect, type TouchEvent } from "react";

export interface UseSwipeDismissOptions {
  /** Called when the gesture completes and meets both threshold + velocity. */
  onDismiss: () => void;
  /** Swipe axis. "x" for horizontal drawers, "y" for bottom sheets. Default: "x". */
  axis?: "x" | "y";
  /** Minimum travel distance in px required to fire onDismiss. Default: 80. */
  threshold?: number;
  /** Minimum travel velocity in px/ms. Default: 0.4. */
  velocityThreshold?: number;
  /** Max opposite-axis travel before the gesture is cancelled as a scroll. Default: 30. */
  crossAxisLimit?: number;
}

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: TouchEvent<HTMLElement>) => void;
  /** Live drag offset along the swipe axis (0 when idle). Mount on `transform: translateX(dragOffset)px`. */
  dragOffset: number;
}

/**
 * Touch-driven swipe-to-dismiss for drawers and bottom sheets.
 *
 * Cancels when the user scrolls vertically/horizontally past crossAxisLimit
 * so it never fights with native scroll on the chat area.
 *
 * Fires onDismiss only when both distance ≥ threshold AND velocity ≥
 * velocityThreshold, so a slow drag does not dismiss by accident.
 */
export function useSwipeDismiss({
  onDismiss,
  axis = "x",
  threshold = 80,
  velocityThreshold = 0.4,
  crossAxisLimit = 30,
}: UseSwipeDismissOptions): SwipeHandlers {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const onTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    setDragOffset(0);
  }, []);

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      const start = startRef.current;
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (axis === "x") {
        if (Math.abs(dy) > crossAxisLimit) {
          startRef.current = null;
          setDragOffset(0);
          return;
        }
        setDragOffset(dx);
      } else {
        if (Math.abs(dx) > crossAxisLimit) {
          startRef.current = null;
          setDragOffset(0);
          return;
        }
        setDragOffset(dy);
      }
    },
    [axis, crossAxisLimit]
  );

  const onTouchEnd = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      const start = startRef.current;
      const t = e.changedTouches[0];
      if (!start || !t) {
        startRef.current = null;
        setDragOffset(0);
        return;
      }
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = Math.max(1, Date.now() - start.t);
      const distance = axis === "x" ? dx : dy;
      const velocity = Math.abs(distance) / dt;
      if (Math.abs(distance) >= threshold && velocity >= velocityThreshold) {
        onDismiss();
      }
      startRef.current = null;
      setDragOffset(0);
    },
    [axis, threshold, velocityThreshold, onDismiss]
  );

  useEffect(() => {
    return () => {
      startRef.current = null;
    };
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, dragOffset };
}
