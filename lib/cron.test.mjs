import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url);
}

test("parseCron accepts wildcard fields", async () => {
  const { parseCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  const cron = parseCron("* * * * *");
  assert.equal(cron.minutes.length, 60);
  assert.equal(cron.hours.length, 24);
  assert.equal(cron.dayOfMonth.length, 31);
  assert.equal(cron.month.length, 12);
  assert.equal(cron.dayOfWeek.length, 7);
});

test("parseCron handles explicit values, steps, ranges and lists", async () => {
  const { parseCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  assert.deepEqual(parseCron("*/15 * * * *").minutes, [0, 15, 30, 45]);
  assert.deepEqual(parseCron("0 9-17 * * *").hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(parseCron("0,30 * * * *").minutes, [0, 30]);
  assert.deepEqual(parseCron("*/20 0-4 */2 * *").minutes, [0, 20, 40]);
  assert.deepEqual(parseCron("5 4 * * *").hours, [4]);
});

test("parseCron expands month and weekday names", async () => {
  const { parseCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  assert.deepEqual(parseCron("0 0 1 jan *").month, [1]);
  assert.deepEqual(parseCron("0 0 * * mon").dayOfWeek, [1]);
  assert.deepEqual(parseCron("0 0 1,15 jun,dec *").month, [6, 12]);
});

test("parseCron rejects too few fields", async () => {
  const { parseCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  assert.throws(() => parseCron("* * * *"));
  assert.throws(() => parseCron(""));
});

test("parseCron rejects out-of-range values", async () => {
  const { parseCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  assert.throws(() => parseCron("60 * * * *"));
  assert.throws(() => parseCron("* 24 * * *"));
  assert.throws(() => parseCron("* * 32 * *"));
  assert.throws(() => parseCron("* * * 13 *"));
  assert.throws(() => parseCron("* * * * 7"));
  assert.throws(() => parseCron("abc * * * *"));
});

test("validateCron returns boolean", async () => {
  const { validateCron } = await loadSubject().then((j) => j.import("./cron.ts"));
  assert.equal(validateCron("* * * * *"), true);
  assert.equal(validateCron("0 9 * * 1-5"), true);
  assert.equal(validateCron("* * * *"), false);
  assert.equal(validateCron("0 99 * * *"), false);
});

test("nextCronRun returns the next matching minute", async () => {
  const { nextCronRun } = await loadSubject().then((j) => j.import("./cron.ts"));
  // from 10:00:30 → next :15 slot for */15
  const from = new Date(2026, 2, 5, 10, 0, 30);
  const next = nextCronRun("*/15 * * * *", from);
  assert.equal(next.getHours(), 10);
  assert.equal(next.getMinutes(), 15);
});

test("nextCronRun rolls across midnight and month end", async () => {
  const { nextCronRun } = await loadSubject().then((j) => j.import("./cron.ts"));
  const from = new Date(2026, 2, 31, 23, 30, 0);
  const next = nextCronRun("0 0 * * *", from);
  assert.equal(next.getMonth(), 3); // April
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 0);
});

test("nextCronRun rolls across year boundary", async () => {
  const { nextCronRun } = await loadSubject().then((j) => j.import("./cron.ts"));
  const from = new Date(2026, 5, 15, 12, 0, 0); // June 2026
  const next = nextCronRun("0 0 1 1 *", from); // Jan 1
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth(), 0);
  assert.equal(next.getDate(), 1);
});

test("nextCronRuns returns successive run times", async () => {
  const { nextCronRuns } = await loadSubject().then((j) => j.import("./cron.ts"));
  const from = new Date(2026, 2, 5, 10, 0, 0);
  const runs = nextCronRuns("*/15 * * * *", 3, from);
  assert.equal(runs.length, 3);
  assert.deepEqual(
    runs.map((d) => d.getMinutes()),
    [15, 30, 45]
  );
});
