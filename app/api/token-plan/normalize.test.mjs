import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./[provider]/_internal.ts");
}

test("normalizeTokenPlan maps a typical minimax payload to a general category", async () => {
  const { normalizeTokenPlan } = await loadSubject();
  const now = Date.now();
  const refresh = new Date(now + 2 * 3600_000).toISOString();
  const cats = normalizeTokenPlan(
    {
      tokens_bought: 100,
      tokens_used: 40,
      tokens_low: 0,
      tokens_refresh_time: refresh,
    },
    now
  );
  assert.equal(cats.length, 1);
  assert.equal(cats[0].name, "general");
  assert.equal(cats[0].intervalUsedPercent, 40);
  assert.equal(cats[0].intervalPercent, 60);
  assert.match(cats[0].intervalResetsIn, /2h/);
  assert.equal(cats[0].available, true);
});

test("normalizeTokenPlan marks unavailable when tokens_low is non-zero", async () => {
  const { normalizeTokenPlan } = await loadSubject();
  const cats = normalizeTokenPlan(
    { tokens_bought: 100, tokens_used: 100, tokens_low: 1 },
    Date.now()
  );
  assert.equal(cats[0].available, false);
  assert.equal(cats[0].intervalPercent, 0);
});

test("normalizeTokenPlan clamps percentages outside 0-100", async () => {
  const { normalizeTokenPlan } = await loadSubject();
  const cats = normalizeTokenPlan(
    { tokens_bought: 10, tokens_used: 50, tokens_low: 0 },
    Date.now()
  );
  assert.equal(cats[0].intervalPercent, 0); // used 500% -> 0 remaining
});
