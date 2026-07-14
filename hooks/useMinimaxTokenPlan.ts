"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TokenPlanCategory = {
  name: string;
  intervalPercent: number;
  intervalResetsIn: string;
  weeklyPercent: number;
  available: boolean;
};

interface UseTokenPlanOptions {
  /**
   * Fires once when the polling hook observes the "general" category's
   * intervalPercent jump from <100 to 100. Used by the auto-resume flow to
   * trigger stored schedules the moment the upstream quota actually resets,
   * rather than relying solely on a possibly-stale `remains_time` timer.
   */
  onIntervalReset?: () => void;
}

type State = {
  categories: TokenPlanCategory[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
};

const POLL_MS = 60_000;
const INITIAL: State = { categories: [], loading: false, error: null, lastUpdated: null };

export function useMinimaxTokenPlan(providerId: string | null, options: UseTokenPlanOptions = {}) {
  const [state, setState] = useState<State>(INITIAL);
  const inFlight = useRef(false);
  const prevGeneralPercent = useRef<number | null>(null);
  const onResetRef = useRef(options.onIntervalReset);
  onResetRef.current = options.onIntervalReset;

  const fetchOnce = useCallback(async () => {
    if (!providerId || inFlight.current) return;
    inFlight.current = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/token-plan/${providerId}`, { cache: "no-store" });
      if (!res.ok) {
        setState((prev) => ({ ...prev, loading: false, error: `http_${res.status}` }));
        return;
      }
      const body = (await res.json()) as { categories?: TokenPlanCategory[]; fetchedAt?: number; error?: string };
      if (body.error || !body.categories) {
        setState((prev) => ({ ...prev, loading: false, error: body.error ?? "bad_payload" }));
        return;
      }
      const general = body.categories.find((c) => c.name === "general");
      const prev = prevGeneralPercent.current;
      const curr = general?.intervalPercent ?? null;
      if (general?.available && curr === 100 && prev !== null && prev < 100) {
        onResetRef.current?.();
      }
      prevGeneralPercent.current = curr;
      setState({ categories: body.categories, loading: false, error: null, lastUpdated: body.fetchedAt ?? Date.now() });
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: String(err) }));
    } finally {
      inFlight.current = false;
    }
  }, [providerId]);

  useEffect(() => {
    if (!providerId) {
      setState(INITIAL);
      prevGeneralPercent.current = null;
      return;
    }
    void fetchOnce();
    const interval = setInterval(fetchOnce, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [providerId, fetchOnce]);

  return { ...state, refresh: fetchOnce };
}