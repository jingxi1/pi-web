import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./notify-types.ts");
}

test("defaultNotifyConfig starts disabled with default fields", async () => {
  const { defaultNotifyConfig, DEFAULT_NOTIFY_EVENTS } = await loadSubject();
  const cfg = defaultNotifyConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.smtp.port, 465);
  assert.equal(cfg.smtp.secure, true);
  assert.equal(cfg.subjectPrefix, "[pi-tools]");
  assert.deepEqual(cfg.events, DEFAULT_NOTIFY_EVENTS);
});

test("mergeWithDefaults fills missing fields", async () => {
  const { mergeWithDefaults } = await loadSubject();
  const merged = mergeWithDefaults({ enabled: true, from: "a@b.c" });
  assert.equal(merged.enabled, true);
  assert.equal(merged.from, "a@b.c");
  assert.equal(merged.to, "");
  assert.equal(merged.smtp.host, "");
  assert.equal(merged.events.agentEnd, true);
});

test("mergeWithDefaults survives null / partial smtp and events", async () => {
  const { mergeWithDefaults } = await loadSubject();
  const merged = mergeWithDefaults({ smtp: { host: "smtp.x", user: "u", pass: "p", port: 587, secure: false } });
  assert.equal(merged.smtp.host, "smtp.x");
  assert.equal(merged.smtp.port, 587);
  assert.equal(merged.smtp.secure, false);
  assert.equal(mergeWithDefaults(null).enabled, false);
});

test("stripPassword removes smtp.pass", async () => {
  const { stripPassword, mergeWithDefaults } = await loadSubject();
  const cfg = mergeWithDefaults({ enabled: true, smtp: { host: "smtp.x", user: "u", pass: "secret", port: 465, secure: true } });
  const stripped = stripPassword(cfg);
  assert.equal("pass" in stripped.smtp, false);
  assert.equal(stripped.smtp.user, "u");
});

test("validateNotifyConfig returns null when disabled or fully configured", async () => {
  const { validateNotifyConfig, mergeWithDefaults } = await loadSubject();
  assert.equal(validateNotifyConfig(mergeWithDefaults({})), null); // disabled
  const good = mergeWithDefaults({
    enabled: true,
    smtp: { host: "smtp.x", port: 465, secure: true, user: "u", pass: "p" },
    from: "a@b.c",
    to: "d@e.f",
  });
  assert.equal(validateNotifyConfig(good), null);
});

test("validateNotifyConfig reports missing fields", async () => {
  const { validateNotifyConfig, mergeWithDefaults } = await loadSubject();
  const smtp = { host: "smtp.x", port: 465, secure: true, user: "u", pass: "p" };
  const enabled = (patch) => mergeWithDefaults({ enabled: true, ...patch });
  assert.match(validateNotifyConfig(enabled({ smtp: { ...smtp, host: "" }, from: "a@b.c", to: "d@e.f" })), /SMTP host/);
  assert.match(validateNotifyConfig(enabled({ smtp: { ...smtp, port: 0 }, from: "a@b.c", to: "d@e.f" })), /port/i);
  assert.match(validateNotifyConfig(enabled({ smtp: { ...smtp, user: "" }, from: "a@b.c", to: "d@e.f" })), /username/i);
  assert.match(validateNotifyConfig(enabled({ smtp, from: "", to: "d@e.f" })), /From/);
  assert.match(validateNotifyConfig(enabled({ smtp, from: "a@b.c", to: "" })), /To/);
});
