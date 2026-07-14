import { NextResponse } from "next/server";
import { formatRemainingSeconds } from "@/lib/time-format";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

type UpstreamModel = {
  model_name: string;
  current_interval_remaining_percent: number;
  current_interval_status: number;
  current_weekly_remaining_percent: number;
  current_weekly_status: number;
  remains_time: number;
};

type UpstreamResponse = {
  model_remains?: UpstreamModel[];
  base_resp?: { status_code: number; status_msg?: string };
};

type Category = {
  name: string;
  intervalPercent: number;
  intervalResetsIn: string;
  weeklyPercent: number;
  available: boolean;
};

const SUPPORTED: Record<string, { envKey: string; url: string }> = {
  "minimax-cn": {
    envKey: "MINIMAX_CN_API_KEY",
    url: "https://api.minimaxi.com/v1/token_plan/remains",
  },
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: { categories: Category[]; fetchedAt: number } }>();

function normalize(upstream: UpstreamResponse) {
  const categories: Category[] = (upstream.model_remains ?? []).map((m) => {
    const intervalAvailable = m.current_interval_status === 1;
    const weeklyAvailable = m.current_weekly_status === 1;
    return {
      name: m.model_name,
      intervalPercent: m.current_interval_remaining_percent,
      intervalResetsIn: intervalAvailable ? formatRemainingSeconds(m.remains_time) : "—",
      weeklyPercent: m.current_weekly_remaining_percent,
      available: intervalAvailable || weeklyAvailable,
    };
  });
  return { categories, fetchedAt: Date.now() };
}

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const cfg = SUPPORTED[provider];
  if (!cfg) {
    return NextResponse.json({ error: "provider_not_supported" }, { status: 404 });
  }

  const apiKey = process.env[cfg.envKey];
  if (!apiKey) {
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 503 });
  }

  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "x-cache": "hit" } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(cfg.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_unavailable" }, { status: 503 });
    }
    const upstream = (await res.json()) as UpstreamResponse;
    if (upstream.base_resp && upstream.base_resp.status_code !== 0) {
      return NextResponse.json({ error: "upstream_rejected" }, { status: 502 });
    }
    const body = normalize(upstream);
    cache.set(provider, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}