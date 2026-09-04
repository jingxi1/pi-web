"use client";

import { useEffect } from "react";
import { onNotifyEvent } from "@/lib/notify-emitter";

/**
 * Forward notify-emitter events to the server dispatch endpoint. Mount once in
 * AppShell via OpenClawIntegration.
 */
export function useNotify(): void {
  useEffect(() => {
    return onNotifyEvent((payload) => {
      fetch("/api/notify/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Dispatching is best-effort; never surface a failure to the UI.
      });
    });
  }, []);
}
