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

function CategoryPill({ cat }: { cat: TokenPlanCategory }) {
  const pct = cat.intervalPercent;
  const color = cat.available ? percentColor(pct) : "var(--text-dim)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 8px",
        borderRadius: 11,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
      }}
      title={`weekly ${cat.weeklyPercent}%`}
    >
      <span
        style={{
          width: 16,
          height: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {categoryChip(cat.name)}
      </span>
      <span style={{ color, fontWeight: 600 }}>{cat.available ? `${pct}%` : "—"}</span>
      {cat.available && cat.intervalResetsIn !== "—" && (
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>⟲{cat.intervalResetsIn}</span>
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
    body = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {categories.map((c) => (
          <span key={c.name} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>{categoryChip(c.name)}</span>
            <span style={{ color: c.available ? percentColor(c.intervalPercent) : "var(--text-dim)", fontWeight: 600 }}>
              {c.available ? `${c.intervalPercent}%` : "—"}
            </span>
          </span>
        ))}
      </span>
    );
  } else {
    body = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 2 }}>
          quota
        </span>
        {categories.map((c) => (
          <CategoryPill key={c.name} cat={c} />
        ))}
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