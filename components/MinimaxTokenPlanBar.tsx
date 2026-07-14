"use client";

import { useCallback, useEffect, useState } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useMinimaxTokenPlan, type TokenPlanCategory } from "@/hooks/useMinimaxTokenPlan";
import { autoResumeStore, useAutoResumeList } from "@/lib/auto-resume-store";
import { formatRemainingSeconds } from "@/lib/time-format";

interface Props {
  enabled: boolean;
}

function percentColor(p: number): string {
  if (p >= 50) return "var(--accent)";
  if (p >= 20) return "#f59e0b";
  return "#f87171";
}

function categoryChip(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function formatAge(ms: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

interface BucketData {
  reset: string;
  used: number;
  total: number;
}

function bucketOf(cat: TokenPlanCategory, kind: "interval" | "weekly"): BucketData {
  if (kind === "interval") {
    return { reset: cat.intervalResetsIn, used: cat.intervalUsedPercent, total: cat.intervalTotalPercent };
  }
  return { reset: cat.weeklyResetsIn, used: cat.weeklyUsedPercent, total: cat.weeklyTotalPercent };
}

function CategoryChip({ cat, kind }: { cat: TokenPlanCategory; kind: "interval" | "weekly" }) {
  const data = bucketOf(cat, kind);
  const showData = cat.available && data.reset !== "—";
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontVariantNumeric: "tabular-nums" }}
      title={`${cat.name} ${kind}: used ${data.used}/${data.total}, resets in ${data.reset}`}
    >
      <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>{categoryChip(cat.name)}</span>
      <span style={{ color: showData ? percentColor(data.total - data.used) : "var(--text-dim)", fontWeight: 600 }}>
        {showData ? `${data.used}/${data.total}` : "—"}
      </span>
      {showData && (
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>⟲{data.reset}</span>
      )}
    </span>
  );
}

export function MinimaxTokenPlanBar({ enabled }: Props) {
  const breakpoint = useBreakpoint();
  const isCompact = breakpoint !== "desktop";
  const { categories, loading, error, lastUpdated, refresh } = useMinimaxTokenPlan(
    enabled ? "minimax-cn" : null,
    { onIntervalReset: () => autoResumeStore.fireOnReset("minimax-cn") }
  );

  const schedules = useAutoResumeList(enabled ? "minimax-cn" : null);
  const [resumeAgeText, setResumeAgeText] = useState<string>("");
  useEffect(() => {
    if (schedules.length === 0) {
      setResumeAgeText("");
      return;
    }
    const earliestWakesAt = schedules.reduce((min, e) => Math.min(min, e.wakesAt), Number.POSITIVE_INFINITY);
    const update = () => {
      const remain = Math.max(0, earliestWakesAt - Date.now());
      setResumeAgeText(formatRemainingSeconds(remain / 1000));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [schedules]);
  const handleCancelAllResume = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm(`Cancel auto-resume for all ${schedules.length} pending session(s)?`)) return;
    autoResumeStore.cancelAllForProvider("minimax-cn");
  }, [schedules.length]);

  const [ageText, setAgeText] = useState<string>("");
  useEffect(() => {
    if (!lastUpdated) {
      setAgeText("");
      return;
    }
    const update = () => setAgeText(formatAge(lastUpdated, Date.now()));
    update();
    const id = setInterval(update, 15_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  if (!enabled) return null;

  let body: React.ReactNode;
  if (loading && categories.length === 0) {
    body = <span style={{ fontSize: 11, color: "var(--text-muted)" }}>…</span>;
  } else if (error && categories.length === 0) {
    body = (
      <span style={{ fontSize: 11, color: "var(--text-dim)" }} title={error}>
        quota —
      </span>
    );
  } else if (categories.length === 0) {
    body = null;
  } else if (isCompact) {
    const general = categories.find((c) => c.name === "general");
    if (!general) {
      body = null;
    } else {
      body = (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>5h</span>
            <span style={{ color: general.available ? percentColor(general.intervalTotalPercent - general.intervalUsedPercent) : "var(--text-dim)", fontWeight: 600 }}>
              {general.available ? `${general.intervalUsedPercent}/${general.intervalTotalPercent}` : "—"}
            </span>
            {general.intervalResetsIn !== "—" && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>⟲{general.intervalResetsIn}</span>}
          </span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>wk</span>
            <span style={{ color: general.available ? percentColor(general.weeklyTotalPercent - general.weeklyUsedPercent) : "var(--text-dim)", fontWeight: 600 }}>
              {general.available ? `${general.weeklyUsedPercent}/${general.weeklyTotalPercent}` : "—"}
            </span>
            {general.weeklyResetsIn !== "—" && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>⟲{general.weeklyResetsIn}</span>}
          </span>
        </span>
      );
    }
  } else {
    body = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 24, padding: "0 8px", borderRadius: 6,
            background: "var(--bg)", border: "1px solid var(--border)",
          }}
          title="5-hour interval quota"
        >
          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>5h</span>
          {categories.filter((c) => c.name !== "video").map((c) => <CategoryChip key={c.name} cat={c} kind="interval" />)}
        </span>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 24, padding: "0 8px", borderRadius: 6,
            background: "var(--bg)", border: "1px solid var(--border)",
          }}
          title="Weekly quota"
        >
          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>wk</span>
          {categories.filter((c) => c.name !== "video").map((c) => <CategoryChip key={c.name} cat={c} kind="weekly" />)}
        </span>
      </span>
    );
  }

  const title = lastUpdated ? `updated ${ageText}` : undefined;
  const resumePill = !isCompact && schedules.length > 0 ? (
    <span
      title={`${schedules.length} session(s) waiting for quota reset`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 6px 0 8px",
        borderRadius: 11,
        background: "rgba(59,130,246,0.10)",
        border: "1px solid rgba(59,130,246,0.30)",
        color: "rgba(30,80,200,0.95)",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 500,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
      <span>{schedules.length} in {resumeAgeText || "—"}</span>
      <button
        type="button"
        onClick={handleCancelAllResume}
        aria-label="Cancel all auto-resume schedules"
        title="Cancel all"
        style={{
          background: "transparent", border: "none", color: "rgba(30,80,200,0.7)",
          cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1, display: "flex",
        }}
      >
        ×
      </button>
    </span>
  ) : null;

  return (
    <div
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 4px 0 10px",
        borderRight: "1px solid var(--border)",
      }}
    >
      {body}
      {resumePill}
      <button
        type="button"
        onClick={() => void refresh()}
        aria-label="Refresh quota"
        title="Refresh"
        disabled={loading}
        style={{
          width: 22,
          height: 22,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: loading ? "wait" : "pointer",
          padding: 0,
          opacity: loading ? 0.5 : 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ animation: loading ? "spin 0.8s linear infinite" : undefined }}
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  );
}