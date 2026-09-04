import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./auto-resume-store.ts");
}

let store = {};
let mod = null;

function memStorage() {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => void (store[k] = v),
    removeItem: (k) => void delete store[k],
  };
}

function entry(over = {}) {
  return {
    sessionId: "s1",
    providerId: "minimax-cn",
    lastPrompt: "hi",
    wakesAt: Date.now() + 60_000,
    createdAt: Date.now(),
    ...over,
  };
}

test("auto-resume store persists and lists entries", async () => {
  mod = await loadSubject();
  store = {};
  mod.__setAutoResumeStorage(memStorage());
  mod.schedule(entry());
  assert.equal(mod.list().length, 1);
  assert.equal(mod.listPending().length, 1);
});

test("schedule upserts by sessionId", async () => {
  store = {};
  mod.__setAutoResumeStorage(memStorage());
  mod.schedule(entry({ lastPrompt: "first" }));
  mod.schedule(entry({ lastPrompt: "second" }));
  const all = mod.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].lastPrompt, "second");
});

test("cancel removes an entry", async () => {
  store = {};
  mod.__setAutoResumeStorage(memStorage());
  mod.schedule(entry());
  mod.cancel("s1");
  assert.equal(mod.list().length, 0);
});

test("fireOnReset only fires expired entries for the provider", async () => {
  store = {};
  mod.__setAutoResumeStorage(memStorage());
  const now = Date.now();
  mod.schedule(entry({ sessionId: "a", providerId: "minimax-cn", wakesAt: now - 1000 }));
  mod.schedule(entry({ sessionId: "b", providerId: "minimax-cn", wakesAt: now + 1000 }));
  mod.schedule(entry({ sessionId: "c", providerId: "other", wakesAt: now - 1000 }));
  const { fired, remaining } = mod.fireOnReset("minimax-cn", now);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].sessionId, "a");
  assert.deepEqual(remaining.map((e) => e.sessionId).sort(), ["b", "c"]);
  assert.deepEqual(mod.list().map((e) => e.sessionId).sort(), ["b", "c"]);
});
