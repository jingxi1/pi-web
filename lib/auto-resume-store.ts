/**
 * Client-side singleton store for auto-resume scheduling. Persists to
 * localStorage under `pi-auto-resume-v1`. Each entry records a prompt that
 * was rejected by a quota/billing error together with when the quota resets
 * (`wakesAt`); the caller fires the pending prompts once the reset is detected.
 */

export interface AutoResumeEntry {
  sessionId: string;
  providerId: string;
  lastPrompt: string;
  wakesAt: number; // Unix ms
  createdAt: number; // Unix ms
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "pi-auto-resume-v1";

function defaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage may be unavailable (SSR, privacy mode); fall through.
  }
  return null;
}

let memoryFallback = new Map<string, string>();
let liveStorage: StorageLike | null | undefined;

function storage(): StorageLike | null {
  if (liveStorage === undefined) liveStorage = defaultStorage();
  return liveStorage;
}

/** For tests: point the store at a controllable backend. */
export function __setAutoResumeStorage(backend: StorageLike | null): void {
  liveStorage = backend;
}

function readAll(s: StorageLike): AutoResumeEntry[] {
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function writeAll(s: StorageLike, entries: AutoResumeEntry[]): void {
  s.setItem(KEY, JSON.stringify(entries));
}

function isEntry(value: unknown): value is AutoResumeEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.sessionId === "string" &&
    typeof e.providerId === "string" &&
    typeof e.lastPrompt === "string" &&
    typeof e.wakesAt === "number" &&
    typeof e.createdAt === "number"
  );
}

/** All scheduled entries, regardless of expiration. */
export function list(): AutoResumeEntry[] {
  const s = storage() ?? memoryFallbackStorage();
  return readAll(s);
}

/** Entries whose wakesAt is still in the future. */
export function listPending(now: number = Date.now()): AutoResumeEntry[] {
  return list().filter((e) => e.wakesAt > now);
}

/** Upsert an entry keyed by sessionId. */
export function schedule(entry: AutoResumeEntry): void {
  const s = storage() ?? memoryFallbackStorage();
  const entries = readAll(s).filter((e) => e.sessionId !== entry.sessionId);
  entries.push(entry);
  writeAll(s, entries);
}

/** Remove a single entry by sessionId. */
export function cancel(sessionId: string): void {
  const s = storage() ?? memoryFallbackStorage();
  writeAll(
    s,
    readAll(s).filter((e) => e.sessionId !== sessionId)
  );
}

export interface FireResult {
  fired: AutoResumeEntry[];
  remaining: AutoResumeEntry[];
}

/**
 * Fire every pending entry for `providerId` whose wakesAt has elapsed.
 * Returns duplicates-free entries for the caller to act on (resume/retry).
 */
export function fireOnReset(
  providerId: string,
  now: number = Date.now()
): FireResult {
  const s = storage() ?? memoryFallbackStorage();
  const entries = readAll(s);
  const fired = entries.filter(
    (e) => e.providerId === providerId && e.wakesAt <= now
  );
  const remaining = entries.filter(
    (e) => !(e.providerId === providerId && e.wakesAt <= now)
  );
  if (fired.length > 0) writeAll(s, remaining);
  return { fired, remaining };
}

function memoryFallbackStorage(): StorageLike {
  return {
    getItem: (k) => memoryFallback.get(k) ?? null,
    setItem: (k, v) => void memoryFallback.set(k, v),
    removeItem: (k) => void memoryFallback.delete(k),
  };
}
