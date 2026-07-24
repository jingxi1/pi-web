// Server-side favorites store. Persists favorited session IDs to
// ~/.pi/agent/favorites.json so the data lives independently of any single
// session file — deleting a session file from disk would otherwise leave a
// dangling favorite marker pointing at nothing.
//
// Favorites are scoped to the whole pi-agent dir, not per project, so the
// sidebar can surface a global "Favorites" panel that spans all worktrees
// and projects.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const FAVORITES_FILE = "favorites.json";
const FAVORITES_CACHE_TTL_MS = 30_000;

interface FavoritesCache {
  ids: Set<string>;
  loadedAt: number;
}

declare global {
  var __piFavoritesCache: FavoritesCache | undefined;
  var __piFavoritesPromise: Promise<Set<string>> | undefined;
  var __piFavoritesGeneration: number | undefined;
}

function favoritesPath(): string {
  return join(getAgentDir(), FAVORITES_FILE);
}

function readFromDisk(): Set<string> {
  const path = favoritesPath();
  if (!existsSync(path)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    // Corrupted file — start with an empty set rather than crashing the sidebar.
    return new Set();
  }
}

function writeToDisk(ids: Set<string>): void {
  const path = favoritesPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify([...ids]), "utf8");
}

/**
 * Load the current favorites set with an in-memory cache. The cache survives
 * Next.js hot reload via globalThis, mirroring the pattern used elsewhere
 * (see lib/session-reader.ts).
 */
export async function loadFavorites(): Promise<Set<string>> {
  const cache = globalThis.__piFavoritesCache;
  if (cache && Date.now() - cache.loadedAt < FAVORITES_CACHE_TTL_MS) {
    return cache.ids;
  }
  if (globalThis.__piFavoritesPromise) return globalThis.__piFavoritesPromise;

  const loadPromise = Promise.resolve()
    .then(() => {
      const ids = readFromDisk();
      globalThis.__piFavoritesCache = { ids, loadedAt: Date.now() };
      return ids;
    })
    .finally(() => {
      if (globalThis.__piFavoritesPromise === loadPromise) {
        globalThis.__piFavoritesPromise = undefined;
      }
    });
  globalThis.__piFavoritesPromise = loadPromise;
  return loadPromise;
}

export function invalidateFavoritesCache(): void {
  globalThis.__piFavoritesGeneration = (globalThis.__piFavoritesGeneration ?? 0) + 1;
  globalThis.__piFavoritesCache = undefined;
}

/**
 * Set the favorite state for a session. Returns the resulting state
 * (true = favorited, false = not favorited).
 */
export async function setFavorite(sessionId: string, favorite: boolean): Promise<boolean> {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("sessionId is required");
  }
  const current = await loadFavorites();
  const had = current.has(sessionId);
  if (favorite === had) return favorite;
  const next = new Set(current);
  if (favorite) next.add(sessionId);
  else next.delete(sessionId);
  writeToDisk(next);
  globalThis.__piFavoritesCache = { ids: next, loadedAt: Date.now() };
  return favorite;
}

/** Drop a batch of session IDs from favorites — used by DELETE cleanup. */
export async function dropFavoritesFor(sessionIds: Iterable<string>): Promise<void> {
  const ids = [...sessionIds];
  if (ids.length === 0) return;
  const current = await loadFavorites();
  let changed = false;
  const next = new Set(current);
  for (const id of ids) {
    if (next.delete(id)) changed = true;
  }
  if (!changed) return;
  writeToDisk(next);
  globalThis.__piFavoritesCache = { ids: next, loadedAt: Date.now() };
}