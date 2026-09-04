import assert from "node:assert/strict";
import test from "node:test";

async function load() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./extension-custom-ui-parser.ts");
}

test("empty input yields unknown", async () => {
  const { parseCustomUi } = await load();
  assert.deepEqual(parseCustomUi([]), { kind: "unknown", reason: "empty" });
  assert.equal(parseCustomUi(["", "  "]).kind, "unknown");
});

test("unrecognized plain text yields unknown", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["Just some prose"]);
  assert.equal(r.kind, "unknown");
});

test("strips ANSI color codes", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["\x1b[32m  1. Green option\x1b[0m"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.items[0].label, "Green option");
  }
});

test("single-choice list", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. Option A", "  2. Option B"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.multiSelect, false);
    assert.equal(r.selectedIndex, 0);
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items.map((i) => i.label), ["Option A", "Option B"]);
  }
});

test("single-choice cursor selects highlighted row", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. Option A", "  > 2. Option B"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.selectedIndex, 1);
  }
});

test("multi-choice list", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  [ ] Alpha", "  [✓] Beta", "  [✔] Gamma"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.multiSelect, true);
    assert.equal(r.items[0].selected, false);
    assert.equal(r.items[1].selected, true);
    assert.equal(r.items[2].selected, true);
  }
});

test("multi-choice with cursor", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  > [ ] Alpha", "  [✓] Beta"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.multiSelect, true);
    assert.equal(r.selectedIndex, 0);
  }
});

test("indented description binds to the previous option", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. Option A", "          说明文字", "  2. Option B"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.items[0].description, "说明文字");
    assert.equal(r.items[1].description, undefined);
  }
});

test("custom input slot is recognized", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. React", "  2. Other"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.items[0].isCustom, false);
    assert.equal(r.items[1].isCustom, true);
  }
});

test("custom slot via 'Type your own answer'", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. A", "  2. Type your own answer"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.items[1].isCustom, true);
  }
});

test("editing mode marks the custom slot (▌ cursor)", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. A", "  2. Other▌"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.selectedIndex, 1);
  }
});

test("editing mode marks the custom slot (underscores)", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  1. A", "  2. Other____"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.selectedIndex, 1);
    assert.equal(r.items[1].label, "Other");
  }
});

test("multi-question tab bar is stripped", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["[Q1] [Q2] Review", "  1. Option A", "  2. Option B"]);
  assert.equal(r.kind, "options");
  if (r.kind === "options") {
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].label, "Option A");
  }
});

test("review panel with submit", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  ✓ Q1: 这是答案一", "  ✓ Q2: 这是答案二", "  > Submit"]);
  assert.equal(r.kind, "review");
  if (r.kind === "review") {
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].question, "Q1");
    assert.equal(r.items[0].answer, "这是答案一");
    assert.equal(r.selectedIndex, 2);
  }
});

test("review with confirm variant is recognized", async () => {
  const { parseCustomUi } = await load();
  const r = parseCustomUi(["  ✓ Q1: A", "  > confirm answers"]);
  assert.equal(r.kind, "review");
});
