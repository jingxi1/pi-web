"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "@/components/Toast";
import { ModelSelector, type ModelSelectorOption } from "@/components/ModelSelector";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { formatRemainingSeconds } from "@/lib/time-format";
import type {
  ScheduledTask,
  TaskSchedule,
  TaskRunRecord,
} from "@/lib/scheduled-tasks-types";

interface ListResponse {
  tasks: ScheduledTask[];
  serverTime: string;
}

interface TaskFormState {
  name: string;
  prompt: string;
  cwd: string;
  provider: string;
  modelId: string;
  useModel: boolean;
  scheduleType: "interval" | "daily" | "cron";
  everyMinutes: string;
  dailyTime: string;
  cronExpression: string;
  enabled: boolean;
  emailEnabled: boolean;
  emailTo: string;
}

function taskToForm(task: ScheduledTask): TaskFormState {
  return {
    name: task.name ?? "",
    prompt: task.prompt ?? "",
    cwd: task.cwd ?? "",
    provider: task.model?.provider ?? "",
    modelId: task.model?.modelId ?? "",
    useModel: Boolean(task.model),
    scheduleType: task.schedule ? task.schedule.type : "interval",
    everyMinutes: task.schedule?.type === "interval" ? String(task.schedule.everyMinutes) : "60",
    dailyTime: task.schedule?.type === "daily" ? task.schedule.time : "09:00",
    cronExpression: task.schedule?.type === "cron" ? task.schedule.expression : "0 9 * * *",
    enabled: task.enabled ?? true,
    emailEnabled: Boolean(task.email?.enabled),
    emailTo: task.email?.to ?? "",
  };
}

const EMPTY_FORM: TaskFormState = {
  name: "",
  prompt: "",
  cwd: "",
  provider: "",
  modelId: "",
  useModel: false,
  scheduleType: "interval",
  everyMinutes: "60",
  dailyTime: "09:00",
  cronExpression: "0 9 * * *",
  enabled: true,
  emailEnabled: false,
  emailTo: "",
};

function nextRunFromServer(task: ScheduledTask, serverTime: string): number | null {
  if (!task.nextRunAt || !task.enabled) return null;
  return Math.max(0, Math.floor((new Date(task.nextRunAt).getTime() - new Date(serverTime).getTime()) / 1000));
}

interface ScheduledTasksConfigProps {
  open: boolean;
  onClose: () => void;
}

export function ScheduledTasksConfig({ open, onClose }: ScheduledTasksConfigProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [serverTime, setServerTime] = useState(() => new Date().toISOString());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ task: ScheduledTask; form: TaskFormState } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [knownRoots, setKnownRoots] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelSelectorOption[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduled-tasks");
      const data = (await res.json()) as ListResponse;
      setTasks(data.tasks);
      setServerTime(data.serverTime);
    } catch {
      toast.error("读取定时任务失败");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setCreating(false);
    setConfirmDelete(null);
    void load();
  }, [open, load]);

  // Load known/existing directories for the cwd quick-pick dropdown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/cwd/known-roots")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setKnownRoots(Array.isArray(data?.roots) ? data.roots : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load available models for the ModelSelector (mirrors ChatInput's mapping).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list: { id: string; name: string; provider: string }[] = data?.modelList ?? [];
        setModelOptions(list.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Poll running state so manual runs / scheduler runs stay live in the list.
  useEffect(() => {
    if (!open) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/scheduled-tasks");
        const data = (await res.json()) as ListResponse;
        setTasks(data.tasks);
        setServerTime(data.serverTime);
      } catch {
        // transient; ignore
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<TaskFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  function buildSchedule(formState: TaskFormState): TaskSchedule | null {
    if (formState.scheduleType === "interval") {
      const m = Number(formState.everyMinutes);
      if (!Number.isFinite(m) || m < 1) return null;
      return { type: "interval", everyMinutes: Math.floor(m) };
    }
    if (formState.scheduleType === "daily") {
      if (!/^\d{1,2}:\d{2}$/.test(formState.dailyTime)) return null;
      return { type: "daily", time: formState.dailyTime };
    }
    if (formState.cronExpression.trim().split(/\s+/).length !== 5) return null;
    return { type: "cron", expression: formState.cronExpression.trim() };
  }

  function validateForm(formState: TaskFormState): string | null {
    if (!formState.name.trim()) return "请输入任务名称";
    if (!formState.prompt.trim()) return "请输入任务提示词";
    if (buildSchedule(formState) === null) return "调度配置无效";
    if (formState.emailEnabled && !formState.emailTo.trim()) return "启用邮件时请填写收件人";
    return null;
  }

  async function saveTask(payload: Record<string, unknown>): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/scheduled-tasks", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "保存失败");
        return;
      }
      toast.success(editing ? "任务已更新" : "任务已创建");
      setEditing(null);
      setCreating(false);
      await load();
    } catch {
      toast.error("保存失败，请检查网络");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveForm() {
    const error = validateForm(form);
    if (error) {
      toast.warning(error);
      return;
    }
    const schedule = buildSchedule(form);
    void saveTask({
      id: editing?.task.id,
      name: form.name,
      prompt: form.prompt,
      cwd: form.cwd || undefined,
      model: form.useModel && form.provider && form.modelId
        ? { provider: form.provider, modelId: form.modelId }
        : null,
      schedule,
      enabled: form.enabled,
      email: { enabled: form.emailEnabled, to: form.emailTo || undefined },
    });
  }

  function startEdit(task: ScheduledTask) {
    setEditing({ task, form: taskToForm(task) });
    setForm(taskToForm(task));
    setCreating(false);
    setConfirmDelete(null);
  }

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setConfirmDelete(null);
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "删除失败");
        return;
      }
      toast.success("任务已删除");
      setConfirmDelete(null);
      await load();
    } catch {
      toast.error("删除失败，请检查网络");
    }
  }

  async function handleRun(task: ScheduledTask) {
    setRunningTask(task.id);
    setRunningIds((prev) => new Set(prev).add(task.id));
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}`, { method: "POST" });
      const json = (await res.json()) as { record?: TaskRunRecord; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "执行失败");
      } else if (json.record?.status === "success") {
        toast.success("任务执行完成");
      } else {
        toast.warning(json.record?.errorMessage ?? "任务执行出错");
      }
      await load();
    } catch {
      toast.error("执行请求失败");
    } finally {
      setRunningTask(null);
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  const isDirtyFromScheduler = (task: ScheduledTask) => runningIds.has(task.id);

  const statusFor = (task: ScheduledTask) => {
    const seconds = nextRunFromServer(task, serverTime);
    if (seconds === null) return { label: "已停用", color: "#6b7280" };
    if (seconds === 0) return { label: "即将运行", color: "#fbbf24" };
    return { label: `${formatRemainingSeconds(seconds)} 后`, color: "var(--text-muted, #999)" };
  };

  return (
    <div
      className="oc-modal-backdrop"
      style={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-modal oc-modal-tasks" style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>定时任务</h2>
          <button style={styles.close} onClick={onClose} aria-label="关闭">×</button>
        </div>

        {!editing && !creating ? (
          <>
            <div style={styles.toolbar}>
              <button style={styles.buttonPrimary} onClick={startCreate}>+ 新建任务</button>
              <span style={styles.hint}>在本地调度器中周期性运行提示词，结果可选邮件通知</span>
            </div>
            <div style={styles.list}>
              {tasks.length === 0 && <div style={styles.empty}>暂无定时任务</div>}
              {tasks.map((task) => {
                const status = statusFor(task);
                const running = isDirtyFromScheduler(task);
                const last = task.lastResult;
                return (
                  <div key={task.id} style={styles.card}>
                    <div style={styles.cardMain}>
                      <div style={styles.cardTitleRow}>
                        <span style={styles.cardTitle}>{task.name || task.id.slice(0, 8)}</span>
                        <span style={{ ...styles.pill, color: status.color, borderColor: status.color }}>
                          {running ? "运行中" : status.label}
                        </span>
                        <span style={styles.enabledDot}>
                          {task.enabled ? "启用" : "停用"}
                        </span>
                      </div>
                      <div style={styles.cardPrompt}>{(task.prompt || "").slice(0, 140)}</div>
                      <div style={styles.cardMeta}>
                        <span>调度: {describeSchedule(task)}</span>
                        {last && (
                          <span>
                            上次 {last.status === "success" ? "成功" : "失败"} · {Math.round(last.durationMs / 1000)}s
                            {last.errorMessage ? ` · ${last.errorMessage.slice(0, 60)}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={styles.cardActions}>
                      <button
                        style={styles.buttonGhost}
                        onClick={() => void handleRun(task)}
                        disabled={running}
                      >
                        {runningTask === task.id ? "执行中..." : "执行"}
                      </button>
                      <button style={styles.buttonGhost} onClick={() => startEdit(task)}>编辑</button>
                      <button
                        style={{ ...styles.buttonGhost, color: "#f87171" }}
                        onClick={() => setConfirmDelete(task.id)}
                      >
                        删除
                      </button>
                    </div>
                    {confirmDelete === task.id && (
                      <div style={styles.confirmRow}>
                        <span>确认删除「{task.name || task.id.slice(0, 8)}」？</span>
                        <button style={styles.buttonDanger} onClick={() => void handleDelete(task.id)}>确认</button>
                        <button style={styles.buttonGhost} onClick={() => setConfirmDelete(null)}>取消</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={styles.editor} >
              <div style={styles.row}>
                <label style={styles.field}>
                  <span>任务名称</span>
                  <input style={styles.input} value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="每日汇率汇总" />
                </label>
                <label style={{ ...styles.field, width: 80 }}>
                  <span>启用</span>
                  <input type="checkbox" style={styles.checkbox} checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
                </label>
              </div>

              <label style={styles.field}>
                <span>提示词 (Prompt)</span>
                <textarea
                  style={{ ...styles.input, minHeight: 110, resize: "vertical", fontFamily: "inherit" }}
                  value={form.prompt}
                  onChange={(e) => update({ prompt: e.target.value })}
                  placeholder="给 agent 的完整指令，例如：汇总今天的新闻并整理成要点"
                />
              </label>

              <label style={styles.field}>
                <span>工作目录 (可选)</span>
                <div style={styles.row}>
                  <input
                    style={styles.input}
                    value={form.cwd}
                    onChange={(e) => update({ cwd: e.target.value })}
                    placeholder="留空使用服务默认目录"
                  />
                  <button type="button" style={styles.buttonGhost} onClick={() => setPickerOpen(true)}>
                    浏览…
                  </button>
                </div>
                <select
                  style={styles.input}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__default__") update({ cwd: "" });
                    else if (v) update({ cwd: v });
                  }}
                >
                  <option value="" disabled>已存在的目录…</option>
                  <option value="__default__">（默认目录，清空）</option>
                  {knownRoots.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              {pickerOpen && (
                <DirectoryPicker
                  initialPath={form.cwd || undefined}
                  onCancel={() => setPickerOpen(false)}
                  onSelect={(path) => {
                    update({ cwd: path });
                    setPickerOpen(false);
                  }}
                />
              )}

              <fieldset style={styles.fieldset}>
                <legend style={styles.legend}>模型（可选，默认使用当前模型）</legend>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={form.useModel} onChange={(e) => update({ useModel: e.target.checked })} />
                  指定模型
                </label>
                {form.useModel && (
                  <ModelSelector
                    variant="field"
                    options={modelOptions}
                    value={form.provider && form.modelId ? { provider: form.provider, modelId: form.modelId } : null}
                    onChange={(provider, modelId) => update({ provider, modelId })}
                    onClear={() => update({ provider: "", modelId: "" })}
                    emptyLabel="默认模型"
                  />
                )}
              </fieldset>

              <fieldset style={styles.fieldset}>
                <legend style={styles.legend}>调度</legend>
                <div style={styles.row}>
                  {(["interval", "daily", "cron"] as const).map((type) => (
                    <label key={type} style={styles.radioRow}>
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={form.scheduleType === type}
                        onChange={() => update({ scheduleType: type })}
                      />
                      {type === "interval" ? "间隔" : type === "daily" ? "每日" : "Cron"}
                    </label>
                  ))}
                </div>
                {form.scheduleType === "interval" && (
                  <div style={styles.row}>
                    <label style={styles.field}>
                      <span>每 (分钟)</span>
                      <input style={styles.input} type="number" min={1} value={form.everyMinutes} onChange={(e) => update({ everyMinutes: e.target.value })} />
                    </label>
                  </div>
                )}
                {form.scheduleType === "daily" && (
                  <div style={styles.row}>
                    <label style={styles.field}>
                      <span>运行时间 (HH:MM)</span>
                      <input style={styles.input} value={form.dailyTime} onChange={(e) => update({ dailyTime: e.target.value })} placeholder="09:00" />
                    </label>
                  </div>
                )}
                {form.scheduleType === "cron" && (
                  <div style={styles.row}>
                    <label style={styles.field}>
                      <span>Cron 表达式 (5 字段)</span>
                      <input style={styles.input} value={form.cronExpression} onChange={(e) => update({ cronExpression: e.target.value })} placeholder="0 9 * * *" />
                    </label>
                  </div>
                )}
              </fieldset>

              <fieldset style={styles.fieldset}>
                <legend style={styles.legend}>邮件通知</legend>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={form.emailEnabled} onChange={(e) => update({ emailEnabled: e.target.checked })} />
                  完成后发送邮件
                </label>
                {form.emailEnabled && (
                  <label style={styles.field}>
                    <span>收件人</span>
                    <input style={styles.input} value={form.emailTo} onChange={(e) => update({ emailTo: e.target.value })} placeholder="receiver@example.com" />
                  </label>
                )}
              </fieldset>
            </div>

            <div style={styles.footer}>
              <span style={styles.hint}>
                {editing ? "编辑任务" : "新建任务"}
              </span>
              <div style={styles.footerRight}>
                <button style={styles.buttonGhost} onClick={() => { setEditing(null); setCreating(false); }}>返回</button>
                <button style={styles.buttonPrimary} onClick={handleSaveForm} disabled={saving}>
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function describeSchedule(task: ScheduledTask): string {
  switch (task.schedule?.type) {
    case "interval":
      return `每 ${task.schedule.everyMinutes} 分钟`;
    case "daily":
      return `每天 ${task.schedule.time}`;
    case "cron":
      return `cron: ${task.schedule.expression}`;
    default:
      return "未知";
  }
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-panel, #1e1e1e)",
    color: "var(--text, #e8e8e8)",
    borderRadius: 12,
    padding: 20,
    width: 640,
    maxWidth: "94vw",
    maxHeight: "88vh",
    overflowY: "auto",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 16, margin: 0 },
  close: { background: "none", border: "none", color: "inherit", fontSize: 22, cursor: "pointer" },
  toolbar: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  hint: { fontSize: 12, color: "var(--text-muted, #999)" },
  list: { display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: "62vh" },
  empty: { color: "var(--text-muted, #999)", fontSize: 13, padding: 24, textAlign: "center" },
  card: {
    border: "1px solid var(--bg-hover, #333)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--bg-subtle, #242424)",
  },
  cardMain: { flex: 1 },
  cardTitleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  cardTitle: { fontSize: 14, fontWeight: 600 },
  pill: { fontSize: 11, padding: "1px 8px", borderRadius: 999, border: "1px solid", lineHeight: "16px" },
  enabledDot: { fontSize: 11, color: "var(--text-muted, #999)" },
  cardPrompt: { fontSize: 13, color: "var(--text, #ddd)", marginBottom: 6, whiteSpace: "pre-wrap" },
  cardMeta: { display: "flex", gap: 14, fontSize: 12, color: "var(--text-muted, #999)", flexWrap: "wrap" },
  cardActions: { display: "flex", gap: 8, marginTop: 8 },
  confirmRow: {
    display: "flex", alignItems: "center", gap: 8, marginTop: 8,
    fontSize: 12, color: "#f87171", borderTop: "1px solid var(--bg-hover,#333)", paddingTop: 8,
  },
  editor: { display: "flex", flexDirection: "column", gap: 10 },
  row: { display: "flex", gap: 10, alignItems: "flex-start" },
  field: { display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12, marginBottom: 4 },
  checkbox: { width: 16, height: 16 },
  fieldset: { border: "1px solid var(--bg-hover, #333)", borderRadius: 8, padding: "10px 12px", margin: "2px 0" },
  legend: { fontSize: 13, padding: "0 4px", color: "var(--text-muted, #999)" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, margin: "6px 0", fontSize: 14 },
  radioRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 13 },
  input: {
    background: "var(--bg-subtle, #2a2a2a)",
    border: "1px solid var(--bg-hover, #333)",
    borderRadius: 6,
    color: "inherit",
    padding: "6px 8px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  footerRight: { display: "flex", gap: 8 },
  button: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, border: "none" },
  buttonGhost: {
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13,
    background: "none", border: "1px solid var(--bg-hover, #333)", color: "var(--text, #e8e8e8)",
  },
  buttonPrimary: {
    padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
    background: "var(--accent, #60a5fa)", color: "#0b0f14", border: "none", fontWeight: 600,
  },
  buttonDanger: {
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13,
    background: "#b91c1c", color: "#fff", border: "none",
  },
};
