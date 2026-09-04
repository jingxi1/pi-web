// Minimal 5-field cron parser and next-run calculator.
//
// Fields: minute hour day-of-month month day-of-week
// Supported syntax per field: `*`, `*`/step (asterisk-slash step), `A-B`, `A-B`/step,
// `A,B,C`, single value. Month and weekday accept 3-letter names (jan..dec /
// sun..sat). Day-of-month and day-of-week follow standard OR semantics when both
// are non-`*`.

export interface CronExpression {
  minutes: number[];
  hours: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const RANGES: Record<keyof CronExpression, [number, number]> = {
  minutes: [0, 59],
  hours: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
};

// Values present when a field is fully wildcard (`*`), used to detect wildcard-ness.
const WILDCARD_LENGTH: Record<keyof CronExpression, number> = {
  minutes: 60,
  hours: 24,
  dayOfMonth: 31,
  month: 12,
  dayOfWeek: 7,
};

function resolveValue(raw: string, names?: Record<string, number>): number {
  const lower = raw.toLowerCase();
  if (names && lower in names) return names[lower];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid cron value "${raw}"`);
  return parsed;
}

function addStep(out: Set<number>, lo: number, hi: number, step: number): void {
  for (let v = lo; v <= hi; v += step) out.add(v);
}

function parseField(
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>
): number[] {
  const out = new Set<number>();
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (part === "") throw new Error(`Empty cron field item in "${field}"`);
    let range = part;
    let step = 1;
    if (part.includes("/")) {
      const [base, stepRaw] = part.split("/");
      range = base;
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${stepRaw}"`);
    }
    if (range === "*") {
      addStep(out, min, max, step);
    } else if (range.includes("-")) {
      const [loRaw, hiRaw] = range.split("-");
      const lo = resolveValue(loRaw, names);
      const hi = resolveValue(hiRaw, names);
      if (lo < min || hi > max || lo > hi) throw new Error(`Invalid cron range "${range}"`);
      addStep(out, lo, hi, step);
    } else {
      const v = resolveValue(range, names);
      if (v < min || v > max) throw new Error(`Cron value ${v} out of range`);
      out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const FIELD_KEYS: (keyof CronExpression)[] = ["minutes", "hours", "dayOfMonth", "month", "dayOfWeek"];
const NAMES: (Record<string, number> | undefined)[] = [undefined, undefined, undefined, MONTHS, DOW];

/** Parse a 5-field cron expression into sorted value arrays. Throws on invalid input. */
export function parseCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields (got ${fields.length}): "${expression}"`);
  }
  const parsed: Partial<CronExpression> = {};
  for (let i = 0; i < 5; i++) {
    const key = FIELD_KEYS[i];
    const [min, max] = RANGES[key];
    parsed[key] = parseField(fields[i], min, max, NAMES[i]);
  }
  return parsed as CronExpression;
}

/** Validate a 5-field cron expression; returns true when parseable. */
export function validateCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function isWildcard(cron: CronExpression, key: keyof CronExpression): boolean {
  return cron[key].length === WILDCARD_LENGTH[key];
}

function matches(cron: CronExpression, date: Date): boolean {
  if (!cron.minutes.includes(date.getMinutes())) return false;
  if (!cron.hours.includes(date.getHours())) return false;
  if (!cron.month.includes(date.getMonth() + 1)) return false;

  const domWildcard = isWildcard(cron, "dayOfMonth");
  const dowWildcard = isWildcard(cron, "dayOfWeek");
  if (domWildcard && dowWildcard) return true;
  if (domWildcard) return cron.dayOfWeek.includes(date.getDay());
  if (dowWildcard) return cron.dayOfMonth.includes(date.getDate());
  // Both constrained: OR semantics.
  return cron.dayOfMonth.includes(date.getDate()) || cron.dayOfWeek.includes(date.getDay());
}

const MAX_ITERATIONS = 5 * 366 * 1440; // ~5 years of minutes, bounds pathological schedules

/** Return the next Date after `from` matching the cron expression (exclusive). */
export function nextCronRun(expression: string | CronExpression, from: Date = new Date()): Date {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const ref = new Date(from);
  ref.setSeconds(0, 0);
  ref.setMilliseconds(0);
  ref.setMinutes(ref.getMinutes() + 1);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (matches(cron, ref)) return ref;
    ref.setMinutes(ref.getMinutes() + 1);
  }
  throw new Error("Could not find a next cron run within 5 years");
}

/** Return `count` successive run times after `from`. */
export function nextCronRuns(
  expression: string | CronExpression,
  count: number,
  from: Date = new Date()
): Date[] {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const result: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextCronRun(cron, cursor);
    result.push(next);
    cursor = next;
  }
  return result;
}
