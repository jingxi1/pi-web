"use client";

import { useEffect, useState } from "react";
import {
  useMinimaxTokenPlan,
  generalCategory,
} from "@/hooks/useMinimaxTokenPlan";
import { listPending } from "@/lib/auto-resume-store";
import type { AutoResumeEntry } from "@/lib/auto-resume-store";

interface MinimaxTokenPlanBarProps {
  providerId: string | null;
  enabled: boolean;
  onAutoResume?: (fired: AutoResumeEntry[]) => void;
}

/** Render nothing unless enabled and the plan resolves. */
export function MinimaxTokenPlanBar({ providerId, enabled, onAutoResume }: MinimaxTokenPlanBarProps) {
  const plan = useMinimaxTokenPlan(enabled ? providerId : null, onAutoResume);
  const cat = generalCategory(plan);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!providerId) return;
    const refresh = () => setPendingCount(listPending().filter((e) => e.providerId === providerId).length);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [providerId, plan]);

  if (!enabled || !providerId) return null;
  if (!cat) return null;

  const intervalPercent = clamp(cat.intervalPercent);
  const weeklyPercent = clamp(cat.weeklyPercent);

  return (
    <div style={styles.wrap}>
      <div style={styles.row}>
        <div style={styles.block}>
          <div style={styles.labelRow}>
            <span style={styles.label}>间隔配额</span>
            <span style={styles.value}>
              {cat.intervalPercent}%{cat.intervalResetsIn !== "—" ? ` · ${cat.intervalResetsIn}` : ""}
            </span>
          </div>
          <div style={styles.track}>
            <div style={{ ...styles.fill, width: `${intervalPercent}%`, background: barColor(intervalPercent) }} />
          </div>
        </div>
        <div style={styles.block}>
          <div style={styles.labelRow}>
            <span style={styles.label}>周配额</span>
            <span style={styles.value}>{cat.weeklyPercent}%</span>
          </div>
          <div style={styles.track}>
            <div style={{ ...styles.fill, width: `${clamp(cat.weeklyPercent)}%`, background: barColor(weeklyPercent) }} />
          </div>
        </div>
      </div>
      {pendingCount > 0 && (
        <div style={styles.pill} title="配额重置后自动恢复的服务">
          ↻ {pendingCount} 个待恢复
        </div>
      )}
    </div>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function barColor(percent: number): string {
  if (percent > 50) return "#34d399";
  if (percent > 20) return "#fbbf24";
  return "#f87171";
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--bg-hover, #2a2a2a)",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  row: { display: "flex", gap: 16, flex: 1, flexWrap: "wrap" },
  block: { display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 },
  labelRow: { display: "flex", justifyContent: "space-between", color: "var(--text-muted, #999)" },
  label: {},
  value: { color: "var(--text, #e8e8e8)" },
  track: { height: 5, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, transition: "width 0.4s ease" },
  pill: {
    background: "var(--bg-subtle, #2a2a2a)",
    border: "1px solid var(--bg-hover, #333)",
    borderRadius: 999,
    padding: "3px 10px",
    whiteSpace: "nowrap",
    color: "var(--text, #e8e8e8)",
  },
};
