import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";

const req = createRequire(import.meta.url);
let ptyAvailable = true;
try {
  req("node-pty");
} catch {
  ptyAvailable = false;
}

async function load() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./terminal-command-runner.ts");
}

test("terminal command runner executes a real command via node-pty", { skip: !ptyAvailable && "node-pty unavailable" }, async () => {
  const { runCommand } = await load();
  const r = await runCommand({ command: "echo runner-ok", cwd: process.cwd(), timeout: 15_000 });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /runner-ok/);
  assert.equal(r.timedOut, false);
  assert.equal(r.command, "echo runner-ok");
});

test("completed command runs are retrievable from the store", { skip: !ptyAvailable && "node-pty unavailable" }, async () => {
  const mod = await load();
  const r = await mod.runCommand({ command: "echo stored", cwd: process.cwd(), timeout: 15_000 });
  const got = mod.getCommandRun(r.id);
  assert.equal(got?.id, r.id);
  assert.match(got?.stdout ?? "", /stored/);
});
