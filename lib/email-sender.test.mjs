import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./email-sender.ts");
}
async function loadTypes() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./notify-types.ts");
}

test("isSmtpConfigured detects incomplete configs", async () => {
  const { isSmtpConfigured } = await loadSubject();
  assert.equal(isSmtpConfigured({ host: "", port: 465, secure: true, user: "", pass: "" }), false);
  assert.equal(isSmtpConfigured({ host: "x", port: 465, secure: true, user: "u", pass: "p" }), true);
});

test("sendNotifyEmail is a no-op when the feature is disabled", async () => {
  const { sendNotifyEmail } = await loadSubject();
  const { mergeWithDefaults } = await loadTypes();
  const config = mergeWithDefaults({ enabled: false });
  await sendNotifyEmail(config, { subject: "s", text: "t" }); // must not throw
});

test("sendNotifyEmail is a no-op when SMTP or addresses are incomplete", async () => {
  const { sendNotifyEmail } = await loadSubject();
  const { mergeWithDefaults } = await loadTypes();
  await sendNotifyEmail(mergeWithDefaults({ enabled: true, smtp: {} }), { subject: "s", text: "t" });
  await sendNotifyEmail(mergeWithDefaults({ enabled: true, from: "", to: "" }), { subject: "s", text: "t" });
});

test("verifySmtp rejects on incomplete config", async () => {
  const { verifySmtp } = await loadSubject();
  await assert.rejects(() => verifySmtp({ host: "", port: 465, secure: true, user: "", pass: "" }));
});

test("clearEmailTransporterCache and cachedTransportCount are consistent", async () => {
  const { clearEmailTransporterCache, cachedTransportCount } = await loadSubject();
  clearEmailTransporterCache();
  assert.equal(cachedTransportCount(), 0);
});
