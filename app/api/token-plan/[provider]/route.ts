import { NextResponse } from "next/server";
import { formatRemainingSeconds } from "../../../../lib/time-format";

export const dynamic = "force-dynamic";

/** Supported providers → env key + upstream quota endpoint. */
const SUPPORTED: Record<string, { envKey: string; url: string }> = {
  "minimax-cn": {
    envKey: "MINIMAX_CN_API_KEY",
    url: "https://api.minimaxi.com/v1/query/token_usage",
  },
};

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

interface CacheEntry {
  data: TokenPlanCategories;
  expiresAt: number;
}
type TokenPlanCategories = TokenPlanCategory[];

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TokenPlanCategories>>();

async function queryProvider(provider: string): Promise<TokenPlanCategories> {
  const def = SUPPORTED[provider];
  const apiKey = process.env[def.envKey];
  if (!apiKey) throw new TokenPlanError(503, `${def.envKey} is not configured`);

  const res = await fetch(def.url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // Wait up to 10s for the upstream gauge.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new TokenPlanError(502, `Upstream token-plan request failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: RawTokenPlan;
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const data = json.data ?? (json as unknown as RawTokenPlan);
  return normalizeTokenPlan(data);
}

/** GET — returns quota categories for a provider with a 60s in-memory cache. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!SUPPORTED[provider]) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 404 });
  }

  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { categories: cached.data, fetchedAt: cached.expiresAt - CACHE_TTL_MS } satisfies TokenPlanResponse,
      { headers: { "x-cache": "hit" } }
    );
  }

  // Deduplicate concurrent misses for the same provider.
  let request = inflight.get(provider);
  if (!request) {
    request = queryProvider(provider).finally(() => {
      inflight.delete(provider);
    });
    inflight.set(provider, request);
  }

  try {
    const categories = await request;
    cache.set(provider, { data: categories, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(
      { categories, fetchedAt: Date.now() } satisfies TokenPlanResponse,
      { headers: { "x-cache": "miss" } }
    );
  } catch (error) {
    if (error instanceof TokenPlanError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

class TokenPlanError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
