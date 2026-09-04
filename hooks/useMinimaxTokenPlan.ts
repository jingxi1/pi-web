"use client";

import { useEffect, useRef, useState } from "react";
import { fireOnReset } from "@/lib/auto-resume-store";
import type { AutoResumeEntry } from "@/lib/auto-resume-store";
import type { TokenPlanResponse, TokenPlanCategory } from "@/app/api/token-plan/[provider]/route";

const POLL_MS = 60 * 1000;

/**
 * Poll the token-plan API every 60s for a provider and fire auto-resume when a
 * quota interval visibly resets (intervalPercent jumps from <100 to 100).
 */
export function useMinimaxTokenPlan(
  providerId: string | null,
  onReset?: (fired: AutoResumeEntry[]) => void
): TokenPlanResponse | null {
  const [plan, setPlan] = useState<TokenPlanResponse | null>(null);
  const prevIntervalRef = useRef<number>(100);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/token-plan/${encodeURIComponent(providerId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as TokenPlanResponse;
        if (cancelled) return;

        const general = data.categories.find((c) => c.name === "general");
        if (general) {
          const prev = prevIntervalRef.current;
          const current = general.intervalPercent;
          if (prev < 100 && current >= 100) {
            const { fired } = fireOnReset(providerId);
            if (fired.length > 0) onResetRef.current?.(fired);
          }
          prevIntervalRef.current = current;
        }
        setPlan(data);
      } catch {
        // transient network error; keep the previous plan
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [providerId]);

  return plan;
}

/** Convenience: resolve the "general" category from a token-plan response. */
export function generalCategory(plan: TokenPlanResponse | null): TokenPlanCategory | null {
  return plan?.categories.find((c) => c.name === "general") ?? null;
}
