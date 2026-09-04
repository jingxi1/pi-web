import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./time-format.ts");
}

test("formatRemainingSeconds handles zero and negatives", async () => {
  const { formatRemainingSeconds } = await loadSubject();
  assert.equal(formatRemainingSeconds(0), "0s");
  assert.equal(formatRemainingSeconds(-5), "0s");
});

test("formatRemainingSeconds shows seconds when under a minute", async () => {
  const { formatRemainingSeconds } = await loadSubject();
  assert.equal(formatRemainingSeconds(3), "3s");
  assert.equal(formatRemainingSeconds(59), "59s");
});

test("formatRemainingSeconds shows minutes and seconds", async () => {
  const { formatRemainingSeconds } = await loadSubject();
  assert.equal(formatRemainingSeconds(90), "1m 30s");
  assert.equal(formatRemainingSeconds(600), "10m");
});

test("formatRemainingSeconds shows hours and minutes", async () => {
  const { formatRemainingSeconds } = await loadSubject();
  assert.equal(formatRemainingSeconds(2 * 3600 + 30 * 60), "2h 30m");
  assert.equal(formatRemainingSeconds(3600), "1h");
});

test("formatRemainingSeconds shows days and hours", async () => {
  const { formatRemainingSeconds } = await loadSubject();
  assert.equal(formatRemainingSeconds(28 * 3600), "1d 4h");
});
