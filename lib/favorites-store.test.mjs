import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadStore() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./favorites-store.ts");
}

function setupIsolated(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-fav-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    delete globalThis.__piFavoritesCache;
    delete globalThis.__piFavoritesPromise;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("loadFavorites is empty when no file exists", async (t) => {
  setupIsolated(t);
  const { loadFavorites } = await loadStore();
  assert.deepEqual([...loadFavorites(true)], []);
});

test("loadFavorites is empty for corrupt JSON", async (t) => {
  const dir = setupIsolated(t);
  fs.writeFileSync(path.join(dir, "favorites.json"), "not json{{{");
  const { loadFavorites } = await loadStore();
  assert.deepEqual([...loadFavorites(true)], []);
});

test("loadFavorites reads a normal file", async (t) => {
  const dir = setupIsolated(t);
  fs.writeFileSync(path.join(dir, "favorites.json"), JSON.stringify(["s1", "s2"]));
  const { loadFavorites } = await loadStore();
  assert.deepEqual([...loadFavorites(true)], ["s1", "s2"]);
});

test("setFavorite adds, removes and toggles", async (t) => {
  const dir = setupIsolated(t);
  const { setFavorite, loadFavorites } = await loadStore();
  assert.equal(setFavorite("s1"), true); // add
  assert.deepEqual([...loadFavorites(true)], ["s1"]);
  assert.equal(setFavorite("s1", false), false); // explicit remove
  assert.deepEqual([...loadFavorites(true)], []);
  assert.equal(setFavorite("s1", true), true); // explicit add
  assert.equal(setFavorite("s1"), false, "toggle removes existing favorite");
  assert.equal(setFavorite("s1"), true, "toggle re-adds removed favorite");
});

test("favorites persist to disk", async (t) => {
  const dir = setupIsolated(t);
  const { setFavorite } = await loadStore();
  setFavorite("a");
  setFavorite("b");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "favorites.json"), "utf8"));
  assert.deepEqual(new Set(onDisk), new Set(["a", "b"]));
});

test("dropFavoritesFor removes a batch", async (t) => {
  const dir = setupIsolated(t);
  const { setFavorite, dropFavoritesFor, loadFavorites } = await loadStore();
  setFavorite("a");
  setFavorite("b");
  setFavorite("c");
  dropFavoritesFor(["a", "c"]);
  assert.deepEqual([...loadFavorites(true)], ["b"]);
});
