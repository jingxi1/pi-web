import { formatRemainingSeconds } from "../../../../lib/time-format";

export interface TokenPlanCategory {
  name: string;
  intervalPercent: number;
  intervalResetsIn: string;
  intervalUsedPercent: number;
  intervalTotalPercent: number;
  weeklyPercent: number;
  weeklyResetsIn: string;
  weeklyUsedPercent: number;
  weeklyTotalPercent: number;
  available: boolean;
}

export interface TokenPlanResponse {
  categories: TokenPlanCategory[];
  fetchedAt: number;
}

/** Raw upstream shape (MiniMax token usage + account plan), defensively read. */
export interface RawTokenPlan {
  status_used?: number;
  total_tokens?: number;
  tokens_bought?: number;
  tokens_used?: number;
  tokens_low?: number;
  tokens_remaining?: number;
  tokens_refresh_time?: string; // ISO
  weekly_bought?: number;
  weekly_used?: number;
  daily_tokens?: number;
}

function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, value));
}

function resetsIn(toIso: string | undefined, now: number): string {
  if (!toIso) return "—";
  const ms = new Date(toIso).getTime();
  if (!Number.isFinite(ms)) return "—";
  return formatRemainingSeconds(Math.max(0, Math.floor((ms - now) / 1000)));
}

/** Translate an upstream token-usage payload into the API's category shape. */
export function normalizeTokenPlan(raw: RawTokenPlan, now: number = Date.now()): TokenPlanCategory[] {
  const bought = raw.tokens_bought ?? raw.total_tokens ?? 0;
  const used = raw.tokens_used ?? 0;
  const low = raw.tokens_low ?? raw.status_used;
  let available: boolean;
  if (low !== undefined) available = Number(low) === 0;
  else if (raw.tokens_remaining !== undefined) available = Number(raw.tokens_remaining) > 0;
  else available = true;

  const intervalUsedPercent = bought > 0 ? (used / bought) * 100 : 0;
  const intervalPercent = clamp100(100 - intervalUsedPercent);

  const weeklyBought = raw.weekly_bought ?? bought * 7;
  const weeklyUsed = raw.weekly_used ?? used;
  const weeklyTotal = weeklyBought > 0 ? 100 + Math.round((weeklyBought / 100) * 100) : 200;
  const weeklyUsedPercent = weeklyTotal > 0 ? (weeklyUsed / weeklyBought) * 100 : 0;
  const weeklyPercent = clamp100(100 - weeklyUsedPercent);

  return [
    {
      name: "general",
      intervalPercent: Math.round(intervalPercent),
      intervalResetsIn: resetsIn(raw.tokens_refresh_time, now),
      intervalUsedPercent: Math.round(intervalUsedPercent),
      intervalTotalPercent: 100,
      weeklyPercent: Math.round(weeklyPercent),
      weeklyResetsIn: "—",
      weeklyUsedPercent: Math.round(weeklyUsedPercent),
      weeklyTotalPercent: weeklyTotal,
      available,
    },
  ];
}

export class TokenPlanError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
