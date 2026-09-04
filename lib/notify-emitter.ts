"use client";

import type { NotifyEventType } from "@/lib/notify-types";

export interface NotifyEventPayload {
  type: NotifyEventType;
  sessionId?: string | null;
  sessionName?: string | null;
  summary: string;
  detail?: string;
}

type NotifyListener = (payload: NotifyEventPayload) => void;

const listeners = new Set<NotifyListener>();

/** Subscribe to notify events; returns an unsubscribe function. */
export function onNotifyEvent(listener: NotifyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Emit a notify event to all subscribers (agent lifecycle calls this). */
export function emitNotifyEvent(payload: NotifyEventPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // A failing listener must not break the rest of the emitters.
    }
  }
}
