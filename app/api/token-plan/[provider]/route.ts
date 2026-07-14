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
  end_time?: number;
  weekly_end_time?: number;
  weekly_boost_permille?: number;
};

type UpstreamResponse = {
  model_remains?: UpstreamModel[];
  base_resp?: { status_code: number; status_msg?: string };
};

type Category = {
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
  const now = Date.now();
  const categories: Category[] = (upstream.model_remains ?? []).map((m) => {
    const intervalAvailable = m.current_interval_status === 1;
    const weeklyAvailable = m.current_weekly_status === 1;
    const intervalTotal = 100;
    const weeklyTotal = 100 + Math.floor((m.weekly_boost_permille ?? 0) / 10);
    const intervalRemaining = m.current_interval_remaining_percent;
    const weeklyRemaining = m.current_weekly_remaining_percent;
    const intervalResetSec = m.end_time ? Math.max(0, (m.end_time - now) / 1000) : null;
    const weeklyResetSec = m.weekly_end_time ? Math.max(0, (m.weekly_end_time - now) / 1000) : null;
    return {
      name: m.model_name,
      intervalPercent: intervalRemaining,
      intervalResetsIn: intervalResetSec !== null ? formatRemainingSeconds(intervalResetSec) : "—",
      intervalUsedPercent: Math.max(0, intervalTotal - intervalRemaining),
      intervalTotalPercent: intervalTotal,
      weeklyPercent: weeklyRemaining,
      weeklyResetsIn: weeklyResetSec !== null ? formatRemainingSeconds(weeklyResetSec) : "—",
      weeklyUsedPercent: Math.max(0, weeklyTotal - weeklyRemaining),
      weeklyTotalPercent: weeklyTotal,
      available: intervalAvailable || weeklyAvailable,
    };
  });
  return { categories, fetchedAt: now };
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