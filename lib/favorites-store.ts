import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDataDir } from "./agent-data-dir";
import { writePrivateFileAtomicSync } from "./atomic-file";

// Favorites are stored as a JSON array of sessionId strings. A 30s cache plus a
// shared promise avoid hammering the filesystem on concurrent reads, and live on
// globalThis so Next.js hot-reload keeps them.
declare global {
  var __piFavoritesCache: { ids: Set<string>; loadedAt: number } | undefined;
  var __piFavoritesPromise: Promise<Set<string>> | undefined;
  var __piFavoritesGeneration: number | undefined;
}

const CACHE_TTL_MS = 30_000;

export function getFavoritesPath(): string {
  return join(getAgentDataDir(), "favorites.json");
}

function readFromDisk(): Set<string> {
  try {
    const raw = readFileSync(getFavoritesPath(), "utf8");
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed) ? parsed : parsed?.favoriteSessionIds ?? [];
    return new Set(ids.filter((id: unknown): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeToDisk(ids: Set<string>): void {
  mkdirSync(getAgentDataDir(), { recursive: true });
  writePrivateFileAtomicSync(getFavoritesPath(), JSON.stringify([...ids]));
}

/** Read favorite ids, using a 30s cache unless `force`. Returns a fresh Set. */
export function loadFavorites(force = false): Set<string> {
  const cache = globalThis.__piFavoritesCache;
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return new Set(cache.ids);
  }
  const ids = readFromDisk();
  globalThis.__piFavoritesCache = { ids: new Set(ids), loadedAt: Date.now() };
  return ids;
}

/** Async variant backed by a shared in-flight promise (concurrency-safe). */
export async function loadFavoritesAsync(): Promise<Set<string>> {
  if (!globalThis.__piFavoritesPromise) {
    globalThis.__piFavoritesPromise = Promise.resolve().then(() => loadFavorites());
  }
  try {
    return await globalThis.__piFavoritesPromise;
  } finally {
    globalThis.__piFavoritesPromise = undefined;
  }
}

/**
 * Set (or, when `favorite` is undefined/null, toggle) a session as favorite.
 * Returns the new favorite state. Persists immediately.
 */
export function setFavorite(sessionId: string, favorite?: boolean | null): boolean {
  const ids = loadFavorites();
  const current = ids.has(sessionId);
  const next = favorite ?? !current;
  if (next) ids.add(sessionId);
  else ids.delete(sessionId);
  writeToDisk(ids);
  globalThis.__piFavoritesGeneration = (globalThis.__piFavoritesGeneration ?? 0) + 1;
  globalThis.__piFavoritesCache = { ids: new Set(ids), loadedAt: Date.now() };
  return next;
}

/** Overwrite the whole favorite list (used to restore a persisted set). */
export function setFavorites(ids: string[]): Set<string> {
  const set = new Set(ids.filter((id: unknown): id is string => typeof id === "string"));
  writeToDisk(set);
  globalThis.__piFavoritesGeneration = (globalThis.__piFavoritesGeneration ?? 0) + 1;
  globalThis.__piFavoritesCache = { ids: new Set(set), loadedAt: Date.now() };
  return new Set(set);
}

/** Remove a batch of session ids (used when sessions are deleted). */
export function dropFavoritesFor(sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  const ids = loadFavorites();
  let changed = false;
  for (const id of sessionIds) {
    if (ids.delete(id)) changed = true;
  }
  if (changed) writeToDisk(ids);
  globalThis.__piFavoritesCache = { ids: new Set(ids), loadedAt: Date.now() };
}
