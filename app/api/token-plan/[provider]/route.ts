import { NextResponse } from "next/server";
import {
  normalizeTokenPlan,
  TokenPlanError,
  type RawTokenPlan,
  type TokenPlanCategory,
  type TokenPlanResponse,
} from "./_internal";

export { normalizeTokenPlan, TokenPlanError };
export type { RawTokenPlan, TokenPlanCategory, TokenPlanResponse };

export const dynamic = "force-dynamic";

/** Supported providers → env key + upstream quota endpoint. */
const SUPPORTED: Record<string, { envKey: string; url: string }> = {
  "minimax-cn": {
    envKey: "MINIMAX_CN_API_KEY",
    url: "https://api.minimaxi.com/v1/query/token_usage",
  },
};

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
