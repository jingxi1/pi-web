import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./quota-error.ts");
}

test("isQuotaError matches quota and billing patterns", async () => {
  const { isQuotaError } = await loadSubject();
  assert.equal(isQuotaError("Quota exceeded for the current interval"), true);
  assert.equal(isQuotaError("insufficient quota"), true);
  assert.equal(isQuotaError("Your account has a billing issue"), true);
  assert.equal(isQuotaError("HTTP 429 Too Many Requests"), true);
  assert.equal(isQuotaError("rate limit exceeded"), true);
  assert.equal(isQuotaError("resource exhausted"), true);
});

test("isQuotaError is case-insensitive", async () => {
  const { isQuotaError } = await loadSubject();
  assert.equal(isQuotaError("QUOTA EXCEEDED"), true);
  assert.equal(isQuotaError("Billing"), true);
});

test("isQuotaError returns false for unrelated errors", async () => {
  const { isQuotaError } = await loadSubject();
  assert.equal(isQuotaError("Connection timed out"), false);
  assert.equal(isQuotaError("Invalid API key"), false);
  assert.equal(isQuotaError("Syntax error in code"), false);
  assert.equal(isQuotaError(""), false);
  assert.equal(isQuotaError(undefined), false);
});
