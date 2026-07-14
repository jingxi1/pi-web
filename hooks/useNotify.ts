"use client";

import { useEffect, useRef } from "react";
import { onNotifyEvent, type NotifyEvent } from "@/lib/notify-emitter";

export function useNotify() {
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    const off = onNotifyEvent((event: NotifyEvent) => {
      const dedupKey = `${event.type}:${event.sessionId}:${event.summary.slice(0, 100)}`;
      if (dedupKey === lastSentRef.current) return;
      lastSentRef.current = dedupKey;

      fetch("/api/notify/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: event.type,
          sessionId: event.sessionId,
          sessionName: event.sessionName,
          summary: event.summary,
          detail: event.detail,
        }),
      }).catch(() => {
        // silently ignore — notification failure should not break the app
      });
    });

    return off;
  }, []);
}
