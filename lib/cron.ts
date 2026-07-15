const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export type CronParseResult =
  | { ok: true; minutes: Set<number>; hours: Set<number>; days: Set<number>; months: Set<number>; dows: Set<number>; domRestricted: boolean; dowRestricted: boolean }
  | { ok: false; error: string };

function resolveToken(
  tok: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number | null {
  const t = tok.trim().toLowerCase();
  if (!t) return null;
  if (names && t in names) return names[t];
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function expandField(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): { values: Set<number>; restricted: boolean } | { error: string } {
  if (raw === "*") return { values: new Set<number>(), restricted: false };
  const out = new Set<number>();
  const parts = raw.split(",");
  for (const partRaw of parts) {
    const part = partRaw.trim().toLowerCase();
    if (!part) return { error: `空字段` };

    let stepStr: string | undefined;
    let rangeStr = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      rangeStr = part.slice(0, slashIdx);
      stepStr = part.slice(slashIdx + 1);
    }
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) return { error: `步长无效: ${stepStr}` };

    let lo: number;
    let hi: number;
    if (rangeStr === "*") {
      lo = min;
      hi = max;
    } else if (rangeStr.includes("-")) {
      const [a, b] = rangeStr.split("-");
      const la = resolveToken(a, min, max, names);
      const lb = resolveToken(b, min, max, names);
      if (la === null || lb === null) return { error: `范围无效: ${rangeStr}` };
      if (la > lb) return { error: `范围左大于右: ${rangeStr}` };
      lo = la;
      hi = lb;
    } else {
      const v = resolveToken(rangeStr, min, max, names);
      if (v === null) return { error: `值无效: ${rangeStr}` };
      lo = v;
      hi = v;
    }

    for (let v = lo; v <= hi; v += step) {
      out.add(v);
    }
  }
  return { values: out, restricted: true };
}

export function parseCron(expr: string): CronParseResult {
  const trimmed = expr.trim();
  if (!trimmed) return { ok: false, error: "表达式为空" };
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, error: `需要 5 段（分 时 日 月 周），当前 ${fields.length} 段` };
  }
  const [fMin, fHour, fDay, fMon, fDow] = fields;

  const minutes = expandField(fMin, 0, 59);
  if ("error" in minutes) return { ok: false, error: `分钟: ${minutes.error}` };
  const hours = expandField(fHour, 0, 23);
  if ("error" in hours) return { ok: false, error: `小时: ${hours.error}` };
  const days = expandField(fDay, 1, 31);
  if ("error" in days) return { ok: false, error: `日: ${days.error}` };
  const months = expandField(fMon, 1, 12, MONTH_NAMES);
  if ("error" in months) return { ok: false, error: `月: ${months.error}` };
  const dows = expandField(fDow, 0, 7, DOW_NAMES);
  if ("error" in dows) return { ok: false, error: `周: ${dows.error}` };
  if (dows.values.has(7)) {
    dows.values.delete(7);
    dows.values.add(0);
  }

  return {
    ok: true,
    minutes: minutes.values,
    hours: hours.values,
    days: days.values,
    months: months.values,
    dows: dows.values,
    domRestricted: days.restricted,
    dowRestricted: dows.restricted,
  };
}

export function validateCron(expr: string): { ok: true } | { ok: false; error: string } {
  const r = parseCron(expr);
  if (!r.ok) return r;
  return { ok: true };
}

const MAX_ITER = 366 * 24 * 60 * 5; // ~2 years of minute-steps

type CronParsed = Extract<CronParseResult, { ok: true }>;

function dayMatches(r: CronParsed, d: Date): boolean {
  const domOk = !r.domRestricted || r.days.has(d.getDate());
  const dowOk = !r.dowRestricted || r.dows.has(d.getDay());
  if (r.domRestricted && r.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const r = parseCron(expr);
  if (!r.ok) return null;
  const cur = new Date(from);
  cur.setSeconds(0, 0);
  cur.setMinutes(cur.getMinutes() + 1);

  for (let i = 0; i < MAX_ITER; i++) {
    const month = cur.getMonth() + 1;
    if (r.months.size > 0 && !r.months.has(month)) {
      cur.setMonth(cur.getMonth() + 1, 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(r, cur)) {
      cur.setDate(cur.getDate() + 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }
    const hour = cur.getHours();
    if (r.hours.size > 0 && !r.hours.has(hour)) {
      cur.setHours(hour + 1, 0, 0, 0);
      continue;
    }
    const minute = cur.getMinutes();
    if (r.minutes.size > 0 && !r.minutes.has(minute)) {
      cur.setMinutes(minute + 1);
      continue;
    }
    return new Date(cur);
  }
  return null;
}

export function nextCronRuns(expr: string, from: Date = new Date(), count = 3): Date[] {
  const out: Date[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < count; i++) {
    const next = nextCronRun(expr, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}
