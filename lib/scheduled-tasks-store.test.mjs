import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadStore() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./scheduled-tasks-store.ts");
}

function setupIsolated(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-tasks-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("computeNextRun for interval schedules", async (t) => {
  setupIsolated(t);
  const { computeNextRun } = await loadStore();
  const from = new Date(2026, 2, 15, 8, 0, 0);
  const next = computeNextRun({ type: "interval", everyMinutes: 60 }, from);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
});

test("computeNextRun for daily schedules (later and earlier today)", async (t) => {
  setupIsolated(t);
  const { computeNextRun } = await loadStore();
  const morning = computeNextRun({ type: "daily", time: "09:00" }, new Date(2026, 2, 15, 8, 0, 0));
  assert.equal(morning.getDate(), 15);
  assert.equal(morning.getHours(), 9);

  const after = computeNextRun({ type: "daily", time: "09:00" }, new Date(2026, 2, 15, 10, 0, 0));
  assert.equal(after.getDate(), 16);
  assert.equal(after.getHours(), 9);
});

test("computeNextRun for cron schedules", async (t) => {
  setupIsolated(t);
  const { computeNextRun } = await loadStore();
  const next = computeNextRun({ type: "cron", expression: "30 2 * * *" }, new Date(2026, 2, 15, 8, 0, 0));
  assert.equal(next.getDate(), 16);
  assert.equal(next.getHours(), 2);
  assert.equal(next.getMinutes(), 30);
});

test("writeTasks / readTasks roundtrip", async (t) => {
  const dir = setupIsolated(t);
  const { writeTasks, readTasks } = await loadStore();
  const tasks = [
    { id: "t1", name: "Test", prompt: "hi", schedule: { type: "interval", everyMinutes: 5 }, enabled: true },
  ];
  writeTasks(tasks);
  assert.deepEqual(readTasks(), tasks);
  assert.ok(fs.existsSync(path.join(dir, "scheduled-tasks.json")));
});

test("readTasks tolerates a missing file", async (t) => {
  setupIsolated(t);
  const { readTasks } = await loadStore();
  assert.deepEqual(readTasks(), []);
});
