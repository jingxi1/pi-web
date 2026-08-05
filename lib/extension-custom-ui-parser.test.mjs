import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  // jiti resolves extensionless TS imports (the parser does `import { stripAnsi } from "./ansi"`).
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./extension-custom-ui-parser.ts");
}

// --- parseCustomUi: top-level behavior ---------------------------------------

test("returns unknown for empty input", async () => {
  const { parseCustomUi } = await loadSubject();
  assert.deepEqual(parseCustomUi([]), { kind: "unknown", reason: "empty" });
  assert.deepEqual(parseCustomUi([""]), { kind: "unknown", reason: "empty" });
  assert.deepEqual(parseCustomUi(["   ", "\t"]), { kind: "unknown", reason: "empty" });
});

test("returns unknown when nothing matches the recognisable patterns", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi(["just some free-form text", "no options here"]);
  assert.equal(out.kind, "unknown");
});

test("strips ANSI from input lines before parsing", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "\x1b[1m\x1b[34mPick one:\x1b[0m",
    "  1. \x1b[32mAlpha\x1b[0m",
    "  > 2. \x1b[33mBeta\x1b[0m",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.items[0].label, "Alpha");
  assert.equal(out.items[1].label, "Beta");
  assert.equal(out.selectedIndex, 1);
});

// --- options: single-select ------------------------------------------------

test("parses a basic single-select panel", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Pick a color:",
    "  1. Red",
    "  2. Green",
    "  3. Blue",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.question, "Pick a color:");
  assert.equal(out.multiSelect, false);
  assert.equal(out.items.length, 3);
  assert.deepEqual(
    out.items.map((i) => i.label),
    ["Red", "Green", "Blue"],
  );
  // No ">" marker means first option is the default highlight.
  assert.equal(out.selectedIndex, 0);
});

test("detects the cursor highlight via leading '> '", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Pick:",
    "  1. One",
    "  > 2. Two",
    "  3. Three",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.selectedIndex, 1);
});

test("treats question text as everything before the first option", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Line one of the question",
    "  continues on this line",
    "  1. First",
    "  2. Second",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.question, "Line one of the question continues on this line");
});

test("stops accumulating question text after the first option is seen", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Question?",
    "  1. Yes",
    "  2. No",
    "Hint: press 1 or 2", // footer/hint after options — should be ignored
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.question, "Question?");
  assert.equal(out.items.length, 2);
});

test("captures the description line under an option", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Choose:",
    "  1. Fast",
    "         Low-latency option",
    "  2. Cheap",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.items[0].label, "Fast");
  assert.equal(out.items[0].description, "Low-latency option");
  assert.equal(out.items[1].description, undefined);
});

test("does not consume a description that is itself the next option", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Choose:",
    "  1. First",
    "  2. Second",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].description, undefined);
});

test("marks the 'Type your own answer' option as isCustom", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Anything else?",
    "  1. Yes",
    "  2. No",
    "  3. Type your own answer",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.items[2].isCustom, true);
  assert.equal(out.items[2].index, 2);
  assert.equal(out.items[0].isCustom, false);
});

test("also recognises 'Other' / 'Custom answer' as the custom slot", async () => {
  const { parseCustomUi } = await loadSubject();
  for (const label of ["Other", "Custom answer", "Your answer"]) {
    const out = parseCustomUi([`  1. Pick`, `  2. ${label}`]);
    assert.equal(out.kind, "options", `label="${label}"`);
    if (out.kind !== "options") return;
    assert.equal(out.items[1].isCustom, true, `label="${label}"`);
  }
});

test("assigns a zero-based index that matches the rendered position", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Q?",
    "  1. A",
    "  2. B",
    "  3. C",
    "  4. D",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.deepEqual(out.items.map((i) => i.index), [0, 1, 2, 3]);
});

// --- options: multi-select -------------------------------------------------

test("parses a multi-select panel with checkboxes", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Pick several:",
    "  [ ] One",
    "  [✓] Two",
    "  [ ] Three",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.multiSelect, true);
  assert.deepEqual(
    out.items.map((i) => i.checked),
    [false, true, false],
  );
});

test("multi-select recognises ✓ and ✔ as checked marks", async () => {
  const { parseCustomUi } = await loadSubject();
  for (const mark of ["✓", "✔"]) {
    const out = parseCustomUi([`  [${mark}] A`, `  [ ] B`]);
    assert.equal(out.kind, "options", `mark="${mark}"`);
    if (out.kind !== "options") return;
    assert.equal(out.items[0].checked, true, `mark="${mark}"`);
    assert.equal(out.items[1].checked, false, `mark="${mark}"`);
  }
});

test("multi-select cursor ('> ') points at the highlighted row", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Pick:",
    "  [ ] A",
    "  > [✓] B",
    "  [ ] C",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.selectedIndex, 1);
});

test("first multi-select marker locks the panel into multi-select mode", async () => {
  const { parseCustomUi } = await loadSubject();
  // Mixing [ ] and 1. markers — once the first [ ] is seen, subsequent 1.-style
  // lines are still parsed as options but multiSelect stays true.
  const out = parseCustomUi([
    "Mixed:",
    "  [ ] A",
    "  1. B",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.multiSelect, true);
  assert.equal(out.items.length, 2);
});

// --- options: editing / cursor detection -----------------------------------

test("recognises editing mode when cursor ▌ sits on the custom slot", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "Anything else?",
    "  1. Yes",
    "  2. No",
    "  > 3. ✎ Type your own answer ▌",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.selectedIndex, 2);
  assert.equal(out.items[2].isCustom, true);
});

// --- options: tab bar (multi-question) -------------------------------------

test("drops the leading tab bar line in multi-question panels", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "[Q1] [Q2] Review",
    "Pick a color:",
    "  1. Red",
    "  2. Blue",
  ]);
  assert.equal(out.kind, "options");
  if (out.kind !== "options") return;
  assert.equal(out.question, "Pick a color:");
  assert.equal(out.items.length, 2);
});

test("falls back to unknown when only the tab bar is present", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi(["[Tab1] [Tab2] Review"]);
  // No body content → should be unknown, not crash.
  assert.equal(out.kind, "unknown");
});

// --- review tab ------------------------------------------------------------

test("parses a review tab with answered questions and submit row", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "  ✓ Q1: red",
    "  ✓ Q2: small",
    "  > Submit answers",
  ]);
  assert.equal(out.kind, "review");
  if (out.kind !== "review") return;
  assert.equal(out.items.length, 3);
  assert.deepEqual(
    out.items.map((i) => i.questionLabel),
    ["Q1", "Q2", "Submit answers"],
  );
  assert.deepEqual(
    out.items.slice(0, 2).map((i) => i.answer),
    ["red", "small"],
  );
  // Submit row is highlighted by default.
  assert.equal(out.selectedIndex, 2);
});

test("defaults the cursor to the first item when nothing is highlighted", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "  ✓ Q1: yes",
    "  ✓ Q2: no",
  ]);
  assert.equal(out.kind, "review");
  if (out.kind !== "review") return;
  assert.equal(out.selectedIndex, 0);
});

test("case-insensitive match for the Submit label", async () => {
  const { parseCustomUi } = await loadSubject();
  for (const label of ["Submit", "submit", "Submit answers", "confirm"]) {
    const out = parseCustomUi([`  > ${label}`]);
    assert.equal(out.kind, "review", `label="${label}"`);
    if (out.kind !== "review") return;
    assert.equal(out.items[0].questionLabel, label, `label="${label}"`);
  }
});

// --- disambiguation: review vs options --------------------------------------

test("classifies lines starting with '✓' as review even with answers in them", async () => {
  const { parseCustomUi } = await loadSubject();
  const out = parseCustomUi([
    "  ✓ Q1: red",
    "  ✓ Q2: 5",
  ]);
  // No option-style lines → review.
  assert.equal(out.kind, "review");
});

test("prefers options over review when both patterns are present", async () => {
  const { parseCustomUi } = await loadSubject();
  // The "  ✓ " inside an option label would be unusual, but options pattern
  // should win if there are any numbered/list items.
  const out = parseCustomUi([
    "  1. First",
    "  2. Second",
    "  ✓ Q1: answer",
  ]);
  assert.equal(out.kind, "options");
});
