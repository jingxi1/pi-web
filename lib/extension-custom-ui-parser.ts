/**
 * Parse the `extension_ui_request` text panels emitted by Ink TUI-based
 * extensions (pi-openplan's PlanQuestionPrompt is the most common) into a
 * structured object the frontend can render as tappable lists.
 *
 * The parser supports the formats demoed by those panels: single-choice
 * (`1. Label`, `> 1. Label`), multi-choice (`[ ] Label`, `[✓] Label`), a
 * description line indented below an option, a custom-input slot, an optional
 * multi-question tab bar on the first line, and a review tab.
 */

export interface ParsedOption {
  label: string;
  description?: string;
  isCustom: boolean;
  selected: boolean;
}

export interface ParsedReviewItem {
  question: string;
  answer: string;
}

export type ParsedCustomUi =
  | { kind: "options"; question: string; selectedIndex: number; multiSelect: boolean; items: ParsedOption[] }
  | { kind: "review"; selectedIndex: number; items: ParsedReviewItem[] }
  | { kind: "unknown"; reason: string };

const CUSTOM_PATTERNS = [
  /type your own answer/i,
  /\bother\b/i,
  /custom answer/i,
  /your answer/i,
];

const REVIEW_SUBMIT = /^\s*>\s*(submit|submit answers|confirm)\s*$/i;

const TAB_BAR = /^\s*(\[\s*q?\s*\d+(\s*\/\s*\d+)?\s*\]\s*)+[a-z]+/i;

const SINGLE = /^(>)?\s*(\d+)\.\s*(.+)$/;
const SINGLE_WITH_CHECK = /^(>)?\s*\[([ x✓✔xX])\]\s*(\d+)\.\s*(.+)$/;

function stripAnsi(line: string): string {
  return line
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function trailingWhitespaceRuns(s: string): number {
  const m = s.match(/_+$/);
  return m ? m[0].length : 0;
}

function isCustomLabel(label: string): boolean {
  return CUSTOM_PATTERNS.some((p) => p.test(label));
}

function indentOf(line: string): number {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}

function isReviewLine(line: string): boolean {
  // `✓ Q1: answer`
  if (/^\s*✓\s*[^:：]+[:：]/.test(line)) return true;
  if (REVIEW_SUBMIT.test(line)) return true;
  return false;
}

/**
 * Parse a raw panel into a structured description.
 */
export function parseCustomUi(rawLines: string[]): ParsedCustomUi {
  if (!rawLines || rawLines.length === 0) {
    return { kind: "unknown", reason: "empty" };
  }

  const lines = rawLines
    .map((l) => stripAnsi(l).replace(/\r$/, ""))
    .filter((l, i, arr) => i === arr.length - 1 || l.trim().length > 0);

  if (lines.length === 0) {
    return { kind: "unknown", reason: "empty" };
  }

  // A panel that mostly consists of review items / a submit action is a review.
  const reviewish = lines.filter(isReviewLine);
  if (reviewish.length > 0 || REVIEW_SUBMIT.test(lines[lines.length - 1] ?? "")) {
    const items: ParsedReviewItem[] = [];
    let selectedIndex = 0;
    for (const line of lines) {
      const q = line.match(/^\s*([✓✔]?)\s*([^>][^:：]*)[:：]\s*(.+)$/);
      if (q && q[2].trim()) {
        items.push({ question: q[2].trim(), answer: q[3].trim() });
      } else if (REVIEW_SUBMIT.test(line)) {
        selectedIndex = items.length;
      }
    }
    if (items.length === 0) {
      return { kind: "unknown", reason: "no review items recognized" };
    }
    return { kind: "review", selectedIndex, items };
  }

  // Drop a leading multi-tab bar line like `[Q1] [Q2] Review`.
  let start = 0;
  if (TAB_BAR.test(lines[0])) start = 1;

  const items: ParsedOption[] = [];
  let cursorIndex = -1;
  let multiSelect = false;
  let question = "";

  // Push an option; an editing cursor (trailing ▌ or ≥2 underscores) on the
  // label marks that row as focused.
  function pushOption(labelRaw: string, selected: boolean): number {
    const editing = /▌$/.test(labelRaw) || trailingWhitespaceRuns(labelRaw) >= 2;
    const label = labelRaw.replace(/[_▌]+$/, "").trim() || labelRaw.trim();
    items.push({ label, isCustom: isCustomLabel(label), selected });
    return editing ? items.length - 1 : -1;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || isReviewLine(line)) continue;

    // Multi-choice: `[ ] Label`, `[✓] Label`, `> [ ] Label`
    const multi = trimmed.match(/^(>)?\s*\[([ x✓✔xX])\]\s*(.+)$/);
    if (multi) {
      multiSelect = true;
      const editingIndex = pushOption(multi[3], multi[2] !== " ");
      if (multi[1] === ">") cursorIndex = items.length - 1;
      else if (editingIndex >= 0) cursorIndex = editingIndex;
      continue;
    }

    // Single-choice: `1. Label`, `> 1. Label`, or checked single `[x] 1. Label`
    const singleCheck = trimmed.match(SINGLE_WITH_CHECK);
    if (singleCheck) {
      const editingIndex = pushOption(singleCheck[4], singleCheck[2] !== " ");
      if (singleCheck[1] === ">") cursorIndex = items.length - 1;
      else if (editingIndex >= 0) cursorIndex = editingIndex;
      continue;
    }
    const single = trimmed.match(SINGLE);
    if (single) {
      const editingIndex = pushOption(single[3], single[1] === ">");
      if (single[1] === ">") cursorIndex = items.length - 1;
      else if (editingIndex >= 0) cursorIndex = editingIndex;
      continue;
    }

    // Description line indented ≥6 under the previous option.
    if (indentOf(line) >= 6 && items.length > 0) {
      const last = items[items.length - 1];
      last.description = last.description
        ? `${last.description}\n${trimmed}`
        : trimmed;
      continue;
    }

    if (items.length === 0) {
      question = question ? `${question} ${trimmed}` : trimmed;
    }
  }

  if (items.length === 0) {
    return { kind: "unknown", reason: "no options recognized" };
  }

  const selectedIndex = cursorIndex >= 0 ? cursorIndex : 0;
  return { kind: "options", question: question.trim(), selectedIndex, multiSelect, items };
}
