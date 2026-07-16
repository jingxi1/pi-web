/**
 * Parser for Ink-rendered custom UI panels.
 *
 * pi-coding-agent extensions render interactive TUI components (Ink) to plain
 * text lines that get streamed to the web/mobile client. The web can't natively
 * "tap" a checkbox or text input — but the rendered text follows stable patterns
 * (see pi-openplan's PlanQuestionPrompt, the most common use case).
 *
 * This module parses those lines into a structured representation so the mobile
 * frontend can render tappable controls. Patterns supported:
 *
 *   Single-select options:
 *     "  1. Label"           ← unselected
 *     "  > 1. Label"         ← currently highlighted
 *     "      Description"    ← option description (indented to align)
 *
 *   Multi-select options:
 *     "  [ ] Label"          ← unselected, unchecked
 *     "  [✓] Label"          ← unselected, checked
 *     "  > [ ] Label"        ← highlighted, unchecked
 *     "  > [✓] Label"        ← highlighted, checked
 *
 *   Custom input option:
 *     "  N. Type your own answer"
 *     "  > N. ✎ Type your own answer ▌"  ← editing mode (cursor present)
 *
 *   Review tab (multi-question mode):
 *     "  ✓ Tab1: answer"     ← question answer summary
 *     "  > Submit answers"   ← current highlight
 *
 *   Tab bar (multi-question mode):
 *     "[Tab1] ✓Tab2 Review"  ← top of panel
 *
 * The parser is deliberately permissive: if it can't confidently classify a
 * shape, it returns `kind: "unknown"` and the caller falls back to the
 * raw-text monospace view that already exists for desktop users.
 */

import { stripAnsi } from "./ansi";

export interface ParsedOption {
  /** Stable index for key navigation. -1 for the "Other" pseudo-option. */
  index: number;
  /** The label as rendered (ANSI stripped). */
  label: string;
  /** Multi-select checked state. Always false for single-select panels. */
  checked: boolean;
  /** Description line that follows the option, if any. */
  description?: string;
  /** True when this is the "Type your own answer" slot. */
  isCustom: boolean;
}

export interface ParsedReviewItem {
  index: number;
  questionLabel: string;
  answer: string;
}

export type ParsedCustomUi =
  | {
      kind: "options";
      /** Question text shown above the option list (could span multiple lines). */
      question: string;
      /** Currently highlighted option index (server-side cursor). */
      selectedIndex: number;
      /** True when options use [ ] / [✓] checkboxes (multiSelect). */
      multiSelect: boolean;
      /** All visible options including the "Type your own answer" pseudo-option. */
      items: ParsedOption[];
    }
  | {
      kind: "review";
      /** Currently highlighted item index. */
      selectedIndex: number;
      items: ParsedReviewItem[];
    }
  | {
      kind: "unknown";
      reason: string;
    };

/**
 * Match an option line in single-select form: "  N. Label" or "  > N. Label".
 *
 * Anchors on:
 *   - 0–N leading spaces
 *   - optional "> " cursor (2 chars: ">" + " ")
 *   - 1–9 digits then ". "
 *   - then label text
 *
 * The label can contain anything except newlines; we cap at the line length.
 */
const SINGLE_SELECT_RE = /^[ \t]*(> )?(\d{1,2})\.[ \t]+(.*)$/;

/**
 * Match an option line in multi-select form: "  [✓] Label" or "  > [ ] Label".
 * Same prefix rules as single-select but with a [ ] / [✓] marker instead of N.
 */
const MULTI_SELECT_RE = /^[ \t]*(> )?\[([ xX✓✔✗✘])\][ \t]+(.*)$/;

/**
 * Match the "Type your own answer" custom-input option.
 * The label can be the bare placeholder ("Type your own answer") or include
 * the ✎ glyph when the extension uses it. We accept anything that ends in
 * "your answer" (case-insensitive) as the canonical "Other" slot.
 */
const CUSTOM_LABEL_RE = /type your own answer|other|custom answer|your answer/i;

/**
 * Match the inline editing cursor that appears at the end of the custom line
 * when the user is typing into it. The Ink cursor block is U+2588 ("▌") or
 * sometimes "_". This signals the panel wants text input rather than a tap.
 */
const EDITING_CURSOR_RE = /[▌_]\s*$/;

/**
 * Match review-tab lines: "  ✓ Q1: answer" or "  > ✓ Q1: answer".
 * We accept the checkmark prefix that pi-openplan uses for answered questions.
 */
const REVIEW_ANSWER_RE = /^[ \t]*(> )?✓[ \t]+(.*?):[ \t]+(.*)$/;
const REVIEW_SUBMIT_RE = /^[ \t]*>[ \t]+(Submit|submit answers?|confirm)/;

/**
 * Match the tab bar that pi-openplan renders at the top of multi-question
 * panels. The shape is `[Tab1] [Tab2] Review` or `[✓Q1 ✓Q2 Review]`.
 * We require either the literal word "Review" or two or more bracketed
 * groups; the bare `[ ]` checkbox marker must not match.
 */
const TAB_BAR_RE = /\[.+\].*\[|^\s*\[Review\]|\bReview\b/;

/**
 * Parse the normalized lines from an extension custom UI panel.
 *
 * @param rawLines Lines as received from the rpc-manager (pre-normalization).
 *   This function applies `stripAnsi` itself so it stays robust regardless
 *   of whether the caller already normalized the lines.
 */
export function parseCustomUi(rawLines: string[]): ParsedCustomUi {
  const lines = rawLines.map((line) => stripAnsi(line));

  // Drop empty lines and the tab bar at the top — neither are options.
  const bodyLines: string[] = [];
  let tabBarSeen = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!tabBarSeen && TAB_BAR_RE.test(trimmed) && trimmed.length < 200) {
      // First non-empty line in a multi-question render is the tab bar.
      tabBarSeen = true;
      continue;
    }
    bodyLines.push(line);
  }

  if (bodyLines.length === 0) {
    return { kind: "unknown", reason: "empty" };
  }

  // Try to classify as an options panel first (most common).
  const optionsResult = tryParseOptions(bodyLines);
  if (optionsResult) return optionsResult;

  // Then a review panel.
  const reviewResult = tryParseReview(bodyLines);
  if (reviewResult) return reviewResult;

  return { kind: "unknown", reason: "no recognizable pattern" };
}

function tryParseOptions(bodyLines: string[]): ParsedCustomUi | null {
  const items: ParsedOption[] = [];
  let selectedIndex = 0;
  let multiSelect = false;
  let questionLines: string[] = [];

  // Walk lines, accumulating question text until we hit an option pattern.
  let i = 0;
  let sawOption = false;

  for (; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const singleMatch = line.match(SINGLE_SELECT_RE);
    const multiMatch = line.match(MULTI_SELECT_RE);

    if (multiMatch) {
      // First multi-select marker locks the panel into multi-select mode.
      multiSelect = true;
      sawOption = true;
      const [, cursor, mark, labelRaw] = multiMatch;
      const isSel = !!cursor;
      const checked = mark !== " ";
      if (isSel) selectedIndex = items.length;
      const isCustom = CUSTOM_LABEL_RE.test(labelRaw);
      const label = labelRaw.trim();
      // Description (if any) follows on the next line(s) indented 6+ spaces.
      const desc = readDescription(bodyLines, i + 1);
      items.push({
        index: items.length,
        label,
        checked,
        description: desc,
        isCustom,
      });
      i += desc ? 1 : 0;
      continue;
    }

    if (singleMatch) {
      sawOption = true;
      const [, cursor, numStr, labelRaw] = singleMatch;
      const isSel = !!cursor;
      if (isSel) selectedIndex = items.length;
      const isCustom = CUSTOM_LABEL_RE.test(labelRaw);
      const label = labelRaw.trim();
      const desc = readDescription(bodyLines, i + 1);
      items.push({
        index: items.length,
        label,
        checked: false,
        description: desc,
        isCustom,
      });
      i += desc ? 1 : 0;
      // Silence the unused-var lint; numStr is implicit in items.length ordering.
      void numStr;
      continue;
    }

    // Not an option line — if we haven't seen any option yet, treat as
    // part of the question header. Otherwise stop; remaining lines are
    // likely footer/hints we don't need.
    if (!sawOption) {
      questionLines.push(line.trim());
    } else {
      break;
    }
  }

  if (items.length === 0) return null;

  // Detect "editing" state by looking at the currently selected option.
  // If the selected item is the custom slot and the line ends with an
  // editing cursor, the panel is in text-input mode.
  const selected = items[selectedIndex];
  const inEditingMode = selected?.isCustom && EDITING_CURSOR_RE.test(bodyLines.join("\n"));

  return {
    kind: "options",
    question: questionLines.join(" ").trim(),
    selectedIndex: inEditingMode ? selectedIndex : selectedIndex,
    multiSelect,
    items,
  };
}

function tryParseReview(bodyLines: string[]): ParsedCustomUi | null {
  const items: ParsedReviewItem[] = [];
  let selectedIndex = -1;
  let sawReview = false;

  for (const line of bodyLines) {
    const submitMatch = line.match(REVIEW_SUBMIT_RE);
    if (submitMatch) {
      sawReview = true;
      selectedIndex = items.length; // Submit sits at the end of the list.
      items.push({
        index: items.length,
        questionLabel: submitMatch[1],
        answer: "",
      });
      continue;
    }
    const answerMatch = line.match(REVIEW_ANSWER_RE);
    if (answerMatch) {
      sawReview = true;
      const [, cursor, questionLabel, answer] = answerMatch;
      if (cursor) selectedIndex = items.length;
      items.push({
        index: items.length,
        questionLabel: questionLabel.trim(),
        answer: answer.trim(),
      });
      continue;
    }
  }

  if (!sawReview || items.length === 0) return null;
  // If we never saw a cursor highlight, default to the first item.
  if (selectedIndex < 0) selectedIndex = 0;
  return { kind: "review", selectedIndex, items };
}

/**
 * Read the description line that follows an option, if present.
 * Description lines are indented to align under the option label —
 * 6+ spaces of leading whitespace and non-empty content.
 */
function readDescription(lines: string[], startIndex: number): string | undefined {
  if (startIndex >= lines.length) return undefined;
  const line = lines[startIndex];
  // The description indent in pi-openplan is " ".repeat(NESTED_MARGIN + NUM_WIDTH + 2)
  // = 4 + 3 + 2 = 9 spaces. Accept anything ≥ 6 spaces of indent to be lenient.
  if (!/^[ \t]{6,}\S/.test(line)) return undefined;
  // Don't consume lines that look like the next option or a control hint.
  if (SINGLE_SELECT_RE.test(line) || MULTI_SELECT_RE.test(line)) return undefined;
  if (EDITING_CURSOR_RE.test(line)) return undefined;
  return stripAnsi(line).trim();
}