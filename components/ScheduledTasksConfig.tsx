"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { validateCron, nextCronRuns } from "@/lib/cron";
import type {
  ScheduledTask,
  TaskSchedule,
  TaskRunRecord,
} from "@/lib/scheduled-tasks-types";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface FormState {
  name: string;
  prompt: string;
  cwd: string;
  modelProvider: string;
  modelId: string;
  scheduleType: "interval" | "daily" | "cron";
  everyMinutes: string;
  dailyTime: string;
  cronExpr: string;
  enabled: boolean;
  emailEnabled: boolean;
  emailTo: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    prompt: "",
    cwd: "",
    modelProvider: "",
    modelId: "",
    scheduleType: "interval",
    everyMinutes: "60",
    dailyTime: "09:00",
    cronExpr: "*/5 * * * *",
    enabled: true,
    emailEnabled: false,
    emailTo: "",
  };
}

function taskToForm(t: ScheduledTask): FormState {
  return {
    name: t.name,
    prompt: t.prompt,
    cwd: t.cwd,
    modelProvider: t.model?.provider ?? "",
    modelId: t.model?.modelId ?? "",
    scheduleType: t.schedule.type,
    everyMinutes: t.schedule.type === "interval" ? String(t.schedule.everyMinutes) : "60",
    dailyTime: t.schedule.type === "daily" ? t.schedule.time : "09:00",
    cronExpr: t.schedule.type === "cron" ? t.schedule.expression : "*/5 * * * *",
    enabled: t.enabled,
    emailEnabled: t.email?.enabled === true,
    emailTo: t.email?.to ?? "",
  };
}

function formToSchedule(f: FormState): TaskSchedule | null {
  if (f.scheduleType === "interval") {
    const n = Math.floor(Number(f.everyMinutes));
    if (!Number.isFinite(n) || n < 1) return null;
    return { type: "interval", everyMinutes: n };
  }
  if (f.scheduleType === "daily") {
    if (!/^\d{1,2}:\d{2}$/.test(f.dailyTime)) return null;
    return { type: "daily", time: f.dailyTime };
  }
  if (!f.cronExpr.trim()) return null;
  const v = validateCron(f.cronExpr);
  if (!v.ok) return null;
  return { type: "cron", expression: f.cronExpr.trim() };
}

function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function shortenCwd(p: string): string {
  if (!p) return "";
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/, "~");
}

function formatRelative(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = t - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  if (min < 1) return diff >= 0 ? "即将" : "刚刚";
  if (min < 60) return diff >= 0 ? `${min} 分钟后` : `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return diff >= 0 ? `${hr} 小时后` : `${hr} 小时前`;
  const day = Math.round(hr / 24);
  return diff >= 0 ? `${day} 天后` : `${day} 天前`;
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: enabled ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function LabeledInput({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{hint}</span>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  fontSize: 13,
  background: "var(--bg-panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontFamily: "var(--font-sans, inherit)",
  outline: "none",
};

const monoInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-mono)",
};

function CronFeedback({ expr }: { expr: string }) {
  const result = useMemo(() => {
    const trimmed = expr.trim();
    if (!trimmed) return { ok: false as const, error: "请输入 cron 表达式" };
    const v = validateCron(trimmed);
    if (!v.ok) return { ok: false as const, error: v.error };
    const runs = nextCronRuns(trimmed, new Date(), 3);
    if (runs.length === 0) return { ok: true as const, runs: [] as Date[] };
    return { ok: true as const, runs };
  }, [expr]);
  if (!result.ok) {
    return (
      <div style={{ fontSize: 12, color: "#f87171" }}>✗ {result.error}</div>
    );
  }
  if (result.runs.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "#fbbf24" }}>表达式合法，但未来 2 年内无匹配时间</div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text-muted)" }}>
      <span style={{ color: "#22c55e" }}>✓ 合法 · 接下来 {result.runs.length} 次：</span>
      {result.runs.map((d, i) => (
        <span key={i} style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)", paddingLeft: 14 }}>
          {i + 1}. {d.toLocaleString()}
        </span>
      ))}
    </div>
  );
}

function HistoryList({ items }: { items: TaskRunRecord[] }) {
  if (!items || items.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>暂无运行记录</span>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((r, i) => (
        <div
          key={`${r.at}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            borderRadius: 5,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              background: r.status === "success" ? "#22c55e" : "#f87171",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-dim)",
              flexShrink: 0,
            }}
          >
            {formatLocal(r.at)}
          </span>
          <span
            style={{
              color: "var(--text-muted)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.summary}
          </span>
        </div>
      ))}
    </div>
  );
}

interface TaskDetailProps {
  task: ScheduledTask;
  form: FormState;
  setForm: (f: FormState) => void;
  saving: boolean;
  running: boolean;
  saveError: string | null;
  runError: string | null;
  runOutput: string | null;
  onSave: () => void;
  onRunNow: () => void;
  onDelete: () => void;
  onToggleEnabled: (v: boolean) => void;
  models: ModelOption[];
  cwdOptions: string[];
  now: number;
  isMobile: boolean;
  keyboardHeight: number;
  onBack?: () => void;
}

function TaskDetail({
  task,
  form,
  setForm,
  saving,
  running,
  saveError,
  runError,
  runOutput,
  onSave,
  onRunNow,
  onDelete,
  onToggleEnabled,
  models,
  cwdOptions,
  now,
  isMobile,
  keyboardHeight,
  onBack,
}: TaskDetailProps) {
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm({ ...form, [k]: v });

  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the prompt textarea to fit its content, capped at 60vh.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [form.prompt]);

  const providerOptions = useMemo(
    () => Array.from(new Set(models.map((m) => m.provider))),
    [models]
  );
  const modelIdOptions = useMemo(
    () => models.filter((m) => !form.modelProvider || m.provider === form.modelProvider),
    [models, form.modelProvider]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {isMobile && onBack && (
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 13,
            padding: "2px 0",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回列表
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>启用</span>
        <ToggleSwitch
          enabled={form.enabled}
          onChange={(v) => {
            update("enabled", v);
            onToggleEnabled(v);
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          ID: {task.id.slice(0, 8)}
        </span>
      </div>

      <LabeledInput label="名称">
        <input
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="例如：每日巡检 GitLab issue"
          enterKeyHint="next"
          style={inputStyle}
        />
      </LabeledInput>

      <LabeledInput label="提示词">
        <textarea
          ref={promptRef}
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          placeholder="任务触发时发送给模型的提示词"
          rows={isMobile ? 4 : 8}
          enterKeyHint="enter"
          style={{
            ...inputStyle,
            fontFamily: "var(--font-mono)",
            resize: "vertical",
            minHeight: isMobile ? 80 : 120,
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        />
      </LabeledInput>

      <LabeledInput label="工作目录 (cwd)" hint="执行提示词时所在目录；从已有会话的 cwd 中选择">
        <select
          value={form.cwd}
          onChange={(e) => update("cwd", e.target.value)}
          style={monoInputStyle}
        >
          <option value="">— 选择工作目录 —</option>
          {cwdOptions.map((c) => (
            <option key={c} value={c}>
              {shortenCwd(c)}
            </option>
          ))}
          {form.cwd && !cwdOptions.includes(form.cwd) && (
            <option value={form.cwd}>
              {shortenCwd(form.cwd)} （历史值，无对应会话）
            </option>
          )}
        </select>
      </LabeledInput>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <LabeledInput label="模型 Provider" hint="留空 = 默认模型">
            <select
              value={form.modelProvider}
              onChange={(e) => update("modelProvider", e.target.value)}
              disabled={!form.cwd || models.length === 0}
              style={monoInputStyle}
            >
              <option value="">默认</option>
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </LabeledInput>
        </div>
        <div style={{ flex: 1 }}>
          <LabeledInput label="模型 ID">
            <select
              value={form.modelId}
              onChange={(e) => update("modelId", e.target.value)}
              disabled={!form.cwd || models.length === 0}
              style={monoInputStyle}
            >
              <option value="">默认</option>
              {modelIdOptions.map((m) => (
                <option key={`${m.provider}:${m.id}`} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </LabeledInput>
        </div>
      </div>

      <LabeledInput label="调度">
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>
            <input
              type="radio"
              checked={form.scheduleType === "interval"}
              onChange={() => update("scheduleType", "interval")}
            />
            间隔
          </label>
          {form.scheduleType === "interval" && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>每</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={form.everyMinutes}
                onChange={(e) => update("everyMinutes", e.target.value)}
                style={{ ...inputStyle, width: 80 }}
              />
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>分钟</span>
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>
            <input
              type="radio"
              checked={form.scheduleType === "daily"}
              onChange={() => update("scheduleType", "daily")}
            />
            每天
          </label>
          {form.scheduleType === "daily" && (
            <input
              type="time"
              value={form.dailyTime}
              onChange={(e) => update("dailyTime", e.target.value)}
              style={{ ...inputStyle, width: 110 }}
            />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>
            <input
              type="radio"
              checked={form.scheduleType === "cron"}
              onChange={() => update("scheduleType", "cron")}
            />
            Cron
          </label>
        </div>
        {form.scheduleType === "cron" && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={form.cronExpr}
              onChange={(e) => update("cronExpr", e.target.value)}
              placeholder="分 时 日 月 周，例如：0 9 * * 1-5"
              spellCheck={false}
              style={monoInputStyle}
            />
            <CronFeedback expr={form.cronExpr} />
          </div>
        )}
      </LabeledInput>

      <LabeledInput label="邮件通知">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ToggleSwitch
            enabled={form.emailEnabled}
            onChange={(v) => update("emailEnabled", v)}
          />
          <input
            value={form.emailTo}
            onChange={(e) => update("emailTo", e.target.value)}
            placeholder="收件人（留空则用 notify.json 的 to）"
            disabled={!form.emailEnabled}
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="done"
            style={{ ...monoInputStyle, flex: 1, opacity: form.emailEnabled ? 1 : 0.5 }}
          />
        </div>
      </LabeledInput>

      {saveError && (
        <div style={{ fontSize: 12, color: "#f87171" }}>保存失败：{saveError}</div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          ...(isMobile
            ? {
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                background: "var(--bg)",
                paddingTop: 10,
                paddingBottom: 10 + keyboardHeight,
                marginTop: -6,
                borderTop: "1px solid var(--border)",
              }
            : {}),
        }}
      >
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "6px 14px",
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            borderRadius: 6,
            cursor: saving ? "wait" : "pointer",
            fontSize: 13,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onRunNow}
          disabled={running}
          style={{
            padding: "6px 14px",
            background: "none",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: running ? "wait" : "pointer",
            fontSize: 13,
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? "执行中…" : "▶ Run now"}
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "6px 14px",
            background: "none",
            color: "#f87171",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            marginLeft: "auto",
          }}
        >
          删除
        </button>
      </div>

      {runError && (
        <div
          style={{
            padding: "8px 10px",
            fontSize: 12,
            color: "#f87171",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: 6,
          }}
        >
          {runError}
        </div>
      )}
      {runOutput && (
        <div
          style={{
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            maxHeight: 200,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
          }}
        >
          {runOutput}
        </div>
      )}

      <div
        style={{
          marginTop: 4,
          paddingTop: 12,
          borderTop: "1px dashed var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
          运行状态
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12 }}>
          <span style={{ color: "var(--text-dim)" }}>
            上次运行：
            <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>
              {formatLocal(task.lastRunAt)}
            </span>
            {task.lastStatus && (
              <span
                style={{
                  marginLeft: 6,
                  color: task.lastStatus === "success" ? "#22c55e" : "#f87171",
                }}
              >
                {task.lastStatus === "success" ? "✓" : "✗"}
              </span>
            )}
          </span>
          <span style={{ color: "var(--text-dim)" }}>
            下次运行：
            <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>
              {form.enabled ? `${formatLocal(task.nextRunAt)}（${formatRelative(task.nextRunAt, now)}）` : "已停用"}
            </span>
          </span>
        </div>
        {task.lastResult && (
          <pre
            style={{
              margin: 0,
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--text-muted)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              maxHeight: 200,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono)",
            }}
          >
            {task.lastResult}
          </pre>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
          最近运行历史
        </span>
        <HistoryList items={task.history ?? []} />
      </div>
    </div>
  );
}

export function ScheduledTasksConfig({ onClose }: { onClose: () => void }) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === "mobile";
  const keyboardHeight = useKeyboardInset();
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [cwdOptions, setCwdOptions] = useState<string[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scheduled-tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: ScheduledTask[] };
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Collect unique cwds from existing sessions to populate the cwd dropdown
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) return;
        const data = await res.json() as { sessions?: { cwd?: string }[] };
        const cwds = Array.from(
          new Set((data.sessions ?? []).map((s) => s.cwd).filter((c): c is string => !!c))
        );
        if (!cancelled) setCwdOptions(cwds);
      } catch {
        if (!cancelled) setCwdOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh relative times every 30s
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Try to load model list when user selects a cwd
  useEffect(() => {
    if (!form.cwd || !cwdOptions.includes(form.cwd)) { setModels([]); return; }
    let cancelled = false;
    fetch(`/api/models?cwd=${encodeURIComponent(form.cwd)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setModels((data as { modelList?: ModelOption[] }).modelList ?? []);
      })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [form.cwd, cwdOptions]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId]
  );

  const selectTask = useCallback(
    (id: string) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      setSelectedId(id);
      setNewMode(false);
      setForm(taskToForm(t));
      setSaveError(null);
      setRunError(null);
      setRunOutput(null);
      setMobileView("detail");
      if (detailPanelRef.current) detailPanelRef.current.scrollTop = 0;
    },
    [tasks]
  );

  const startNew = useCallback(() => {
    setSelectedId(null);
    setNewMode(true);
    setForm(emptyForm());
    setSaveError(null);
    setRunError(null);
    setRunOutput(null);
    setMobileView("detail");
    if (detailPanelRef.current) detailPanelRef.current.scrollTop = 0;
  }, []);

  const backToList = useCallback(() => {
    setMobileView("list");
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const schedule = formToSchedule(form);
      if (!schedule) {
        setSaveError("调度参数无效");
        return;
      }
      const payload = {
        name: form.name.trim(),
        prompt: form.prompt,
        cwd: form.cwd.trim(),
        model: form.modelProvider && form.modelId
          ? { provider: form.modelProvider, modelId: form.modelId }
          : null,
        schedule,
        enabled: form.enabled,
        email: { enabled: form.emailEnabled, to: form.emailTo.trim() || undefined },
      };
      const url = newMode ? "/api/scheduled-tasks" : `/api/scheduled-tasks`;
      const method = newMode ? "POST" : "PUT";
      const body = newMode ? payload : { id: selectedId, ...payload };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
      if (newMode) {
        const data = await res.json() as { task: ScheduledTask };
        setSelectedId(data.task.id);
        setNewMode(false);
        setForm(taskToForm(data.task));
      } else if (selectedId) {
        const data = await res.json() as { task: ScheduledTask };
        setForm(taskToForm(data.task));
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, newMode, selectedId, load]);

  const handleRunNow = useCallback(async () => {
    if (newMode || !selectedId) {
      setRunError("请先保存任务");
      return;
    }
    setRunning(true);
    setRunError(null);
    setRunOutput(null);
    try {
      const res = await fetch(`/api/scheduled-tasks/${selectedId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = (data as { result?: { status: string; text?: string; errorMessage?: string } }).result;
      if (result?.status === "success") {
        setRunOutput(result.text ?? "(无输出)");
      } else {
        setRunError(result?.errorMessage ?? "执行失败");
      }
      await load();
      const updated = (data as { task?: ScheduledTask }).task;
      if (updated) setForm(taskToForm(updated));
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [newMode, selectedId, load]);

  const handleDelete = useCallback(async () => {
    if (newMode || !selectedId) {
      startNew();
      return;
    }
    if (!window.confirm(`确认删除任务「${selected?.name ?? ""}」？`)) return;
    try {
      const res = await fetch(`/api/scheduled-tasks/${selectedId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSelectedId(null);
      setNewMode(true);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [newMode, selectedId, selected, load, startNew]);

  const handleToggleEnabled = useCallback(
    async (v: boolean) => {
      if (newMode || !selectedId) return;
      const t = tasks.find((x) => x.id === selectedId);
      if (!t) return;
      try {
        const res = await fetch("/api/scheduled-tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: t.id,
            name: t.name,
            prompt: t.prompt,
            cwd: t.cwd,
            model: t.model,
            schedule: t.schedule,
            enabled: v,
            email: t.email,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        await load();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    },
    [newMode, selectedId, tasks, load]
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              定时计划任务
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {tasks.length} 个任务
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
          }}
        >
          {/* Left: task list */}
          <div
            style={{
              width: isMobile ? "100%" : 220,
              display: isMobile && mobileView !== "list" ? "none" : "flex",
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                  Loading…
                </div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#f87171" }}>
                  {error}
                </div>
              ) : tasks.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                  暂无任务，点击下方新建
                </div>
              ) : (
                tasks.map((t) => {
                  const isSel = !newMode && selectedId === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => selectTask(t.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "8px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: isSel ? "var(--bg-selected)" : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSel) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSel) e.currentTarget.style.background = "none";
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: t.enabled ? "var(--accent)" : "var(--border)",
                          boxShadow: t.enabled ? "0 0 4px var(--accent)" : "none",
                          transition: "background 0.15s, box-shadow 0.15s",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: isSel ? 600 : 400,
                            color: "var(--text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.name || "(未命名)"}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.enabled
                            ? `下次 ${formatRelative(t.nextRunAt, now)}`
                            : "已停用"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div
              style={{
                padding: "8px 6px",
                borderTop: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <div
                onClick={startNew}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: newMode ? "var(--bg-selected)" : "none",
                  color: newMode ? "var(--accent)" : "var(--text-dim)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!newMode) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!newMode) e.currentTarget.style.background = "none";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建任务
              </div>
            </div>
          </div>

          {/* Right: detail or new panel */}
          <div
            ref={detailPanelRef}
            onFocus={(e) => {
              if (!isMobile) return;
              const t = e.target as HTMLElement;
              if (t.matches("input, textarea, select")) {
                // Delay so the keyboard has begun resizing the visual viewport
                // before we scroll the focused field into the visible area.
                setTimeout(() => {
                  t.scrollIntoView({ block: "center", behavior: "smooth" });
                }, 100);
              }
            }}
            style={{
              flex: 1,
              display: isMobile && mobileView !== "detail" ? "none" : "block",
              width: isMobile ? "100%" : undefined,
              overflowY: "auto",
              padding: 20,
              paddingBottom: isMobile ? 20 + keyboardHeight : 20,
            }}
          >
            {newMode ? (
              <TaskDetail
                task={{
                  id: "(新任务)",
                  name: form.name,
                  prompt: form.prompt,
                  cwd: form.cwd,
                  model: null,
                  schedule:
                    form.scheduleType === "interval"
                      ? { type: "interval", everyMinutes: Math.max(1, Number(form.everyMinutes) || 1) }
                      : form.scheduleType === "cron"
                        ? { type: "cron", expression: form.cronExpr.trim() }
                        : { type: "daily", time: form.dailyTime },
                  enabled: form.enabled,
                  email: { enabled: form.emailEnabled, to: form.emailTo || undefined },
                  lastRunAt: null,
                  lastStatus: null,
                  lastResult: null,
                  nextRunAt: null,
                  history: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }}
                form={form}
                setForm={setForm}
                saving={saving}
                running={running}
                saveError={saveError}
                runError={runError}
                runOutput={runOutput}
                onSave={handleSave}
                onRunNow={handleRunNow}
                onDelete={handleDelete}
                onToggleEnabled={() => { /* no-op for new mode */ }}
                models={models}
                cwdOptions={cwdOptions}
                now={now}
                isMobile={isMobile}
                keyboardHeight={keyboardHeight}
                onBack={isMobile ? backToList : undefined}
              />
            ) : selected ? (
              <TaskDetail
                task={selected}
                form={form}
                setForm={setForm}
                saving={saving}
                running={running}
                saveError={saveError}
                runError={runError}
                runOutput={runOutput}
                onSave={handleSave}
                onRunNow={handleRunNow}
                onDelete={handleDelete}
                onToggleEnabled={handleToggleEnabled}
                models={models}
                cwdOptions={cwdOptions}
                now={now}
                isMobile={isMobile}
                keyboardHeight={keyboardHeight}
                onBack={isMobile ? backToList : undefined}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                选择左侧任务，或点击「新建任务」
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
