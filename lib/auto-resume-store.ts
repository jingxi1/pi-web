"use client";

// Singleton store for "auto-resume on token reset" schedules.
// Each entry is one stuck session waiting for a quota reset; the store fires
// them when useMinimaxTokenPlan's poll detects intervalPercent jumping back
// to 100. Persisted to localStorage so a tab close during the 5h window
// doesn't lose the schedule.

import { useEffect, useState } from "react";

export type Stored = {
  sessionId: string;
  providerId: string;
  lastPrompt: string;
  wakesAt: number;
  createdAt: number;
};

const STORAGE_KEY = "pi-auto-resume-v1";
const EXPIRY_GRACE_MS = 60_000;

type Listener = () => void;

class AutoResumeStore {
  private entries = new Map<string, Stored>();
  private listeners = new Set<Listener>();
  private hydrated = false;
  private resetsByProvider = new Map<string, (entry: Stored) => void>();

  hydrate(): void {
    if (this.hydrated || typeof window === "undefined") return;
    this.hydrated = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as Stored[];
      const now = Date.now();
      for (const e of arr) {
        if (!e || typeof e.sessionId !== "string" || typeof e.wakesAt !== "number") continue;
        if (e.wakesAt < now - EXPIRY_GRACE_MS) continue;
        this.entries.set(e.sessionId, e);
      }
      this.notify();
    } catch {
      // Ignore: storage may be disabled (private mode, quota). Fall back to
      // in-memory only — losing persistence on reload is acceptable.
    }
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      const arr = Array.from(this.entries.values());
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // Swallow: best-effort persistence.
    }
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  schedule(entry: Stored): void {
    this.hydrate();
    this.entries.set(entry.sessionId, entry);
    this.persist();
    this.notify();
  }

  cancel(sessionId: string): void {
    if (!this.entries.delete(sessionId)) return;
    this.persist();
    this.notify();
  }

  cancelAllForProvider(providerId: string): void {
    let changed = false;
    for (const [id, e] of this.entries) {
      if (e.providerId === providerId) {
        this.entries.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    this.persist();
    this.notify();
  }

  list(): Stored[] {
    this.hydrate();
    const now = Date.now();
    const out: Stored[] = [];
    for (const e of this.entries.values()) {
      if (e.wakesAt < now - EXPIRY_GRACE_MS) continue;
      out.push(e);
    }
    return out;
  }

  get(sessionId: string): Stored | undefined {
    this.hydrate();
    const e = this.entries.get(sessionId);
    if (!e) return undefined;
    if (e.wakesAt < Date.now() - EXPIRY_GRACE_MS) return undefined;
    return e;
  }

  subscribe(cb: Listener): () => void {
    this.hydrate();
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Called by the token-plan polling hook when it detects a reset (jump from
  // <100% back to 100%). Fires all scheduled resumes for that provider and
  // clears them so they don't fire twice.
  fireOnReset(providerId: string): void {
    const toFire: Stored[] = [];
    for (const [id, e] of this.entries) {
      if (e.providerId !== providerId) continue;
      toFire.push(e);
      this.entries.delete(id);
    }
    if (toFire.length === 0) return;
    this.persist();
    this.notify();
    for (const entry of toFire) {
      try {
        const handler = this.resetsByProvider.get(providerId);
        if (handler) handler(entry);
      } catch {
        // Don't let one bad entry break the rest.
      }
    }
  }

  // The active useAgentSession registers a per-provider fire handler. When
  // fireOnReset fires for that provider, the handler is responsible for
  // routing each entry to the right path (active session → triggerResume,
  // inactive session → server endpoint).
  registerFireHandler(providerId: string, handler: (entry: Stored) => void): () => void {
    this.resetsByProvider.set(providerId, handler);
    return () => {
      const cur = this.resetsByProvider.get(providerId);
      if (cur === handler) this.resetsByProvider.delete(providerId);
    };
  }
}

export const autoResumeStore = new AutoResumeStore();

// React subscription helper so components re-render on store changes.
export function useAutoResumeSchedule(sessionId: string | null | undefined): Stored | null {
  const [snap, setSnap] = useState<Stored | null>(() => (sessionId ? autoResumeStore.get(sessionId) ?? null : null));
  useEffect(() => {
    if (!sessionId) {
      setSnap(null);
      return;
    }
    setSnap(autoResumeStore.get(sessionId) ?? null);
    return autoResumeStore.subscribe(() => {
      setSnap(autoResumeStore.get(sessionId) ?? null);
    });
  }, [sessionId]);
  return snap;
}

export function useAutoResumeList(providerId: string | null | undefined): Stored[] {
  const [list, setList] = useState<Stored[]>(() => (providerId ? autoResumeStore.list().filter((e) => e.providerId === providerId) : []));
  useEffect(() => {
    if (!providerId) {
      setList([]);
      return;
    }
    setList(autoResumeStore.list().filter((e) => e.providerId === providerId));
    return autoResumeStore.subscribe(() => {
      setList(autoResumeStore.list().filter((e) => e.providerId === providerId));
    });
  }, [providerId]);
  return list;
}

// All active schedules across providers — used by the sidebar "Running" panel
// to surface sessions that are waiting for a quota reset, regardless of which
// provider's quota they're tied to.
export function useAllAutoResumeSchedules(): Stored[] {
  const [list, setList] = useState<Stored[]>(() => autoResumeStore.list());
  useEffect(() => {
    setList(autoResumeStore.list());
    return autoResumeStore.subscribe(() => {
      setList(autoResumeStore.list());
    });
  }, []);
  return list;
}