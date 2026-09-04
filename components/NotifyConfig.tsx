"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/Toast";
import type {
  NotifyConfig,
  NotifyConfigWithoutPassword,
  NotifyEventType,
} from "@/lib/notify-types";
import { type NotifySmtpConfig } from "@/lib/notify-types";

const EVENT_LABELS: Record<NotifyEventType, string> = {
  agentEnd: "Agent 完成",
  error: "Agent 报错",
  inputNeeded: "需要输入",
};

const EMPTY_SMTP: NotifySmtpConfig = { host: "", port: 465, secure: true, user: "", pass: "" };

const RESULT_SUCCESS = "#2e9e4f";
const RESULT_ERROR = "#d1453b";

interface NotifyConfigProps {
  open: boolean;
  onClose: () => void;
}

export function NotifyConfig({ open, onClose }: NotifyConfigProps) {
  const [enabled, setEnabled] = useState(false);
  const [smtp, setSmtp] = useState<NotifySmtpConfig>({ ...EMPTY_SMTP });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subjectPrefix, setSubjectPrefix] = useState("[pi-tools]");
  const [events, setEvents] = useState<Record<NotifyEventType, boolean>>({
    agentEnd: true,
    error: true,
    inputNeeded: true,
  });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notify");
        const data = (await res.json()) as NotifyConfigWithoutPassword;
        if (cancelled) return;
        setEnabled(data.enabled);
        setSmtp({ ...EMPTY_SMTP, ...data.smtp });
        setFrom(data.from ?? "");
        setTo(data.to ?? "");
        setSubjectPrefix(data.subjectPrefix ?? "[pi-tools]");
        setEvents((prev) => ({ ...prev, ...(data.events ?? {}) }));
      } catch {
        if (!cancelled) toast.error("读取通知配置失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const updateSmtp = (patch: Partial<NotifySmtpConfig>) => setSmtp((prev) => ({ ...prev, ...patch }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/notify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          smtp,
          from,
          to,
          subjectPrefix,
          events,
        } satisfies NotifyConfig),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "保存失败");
        return;
      }
      toast.success("通知配置已保存");
    } catch {
      toast.error("保存失败，请检查网络");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { smtp, from, to, subjectPrefix } }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTestResult({ ok: false, message: json.error ?? "连接失败" });
        return;
      }
      setTestResult({ ok: true, message: "连接成功，SMTP 配置可用" });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setTestResult({ ok: false, message: timedOut ? "连接超时（15 秒无响应）" : "请求失败，请检查网络" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    setSendResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          send: true,
          config: { smtp, from, to, subjectPrefix },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = (await res.json()) as { error?: string; to?: string };
      if (!res.ok) {
        setSendResult({ ok: false, message: json.error ?? "发送失败" });
        return;
      }
      setSendResult({ ok: true, message: `已发送到 ${json.to || "已保存地址"}，请查收` });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setSendResult({ ok: false, message: timedOut ? "发送超时（30 秒无响应）" : "发送请求失败，请检查网络" });
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div
      className="oc-modal-backdrop"
      style={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-modal oc-modal-notify" style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>邮件通知</h2>
          <button style={styles.close} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <label style={styles.checkRow}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用邮件通知
        </label>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>SMTP 配置</legend>
          <div style={styles.row}>
            <label style={styles.field}>
              <span>Host</span>
              <input style={styles.input} value={smtp.host} onChange={(e) => updateSmtp({ host: e.target.value })} placeholder="smtp.qq.com" />
            </label>
            <label style={{ ...styles.field, width: 90 }}>
              <span>Port</span>
              <input style={styles.input} type="number" value={smtp.port} onChange={(e) => updateSmtp({ port: Number(e.target.value) })} />
            </label>
          </div>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={smtp.secure} onChange={(e) => updateSmtp({ secure: e.target.checked })} />
            SSL/TLS (secure)
          </label>
          <div style={styles.row}>
            <label style={styles.field}>
              <span>Username</span>
              <input style={styles.input} value={smtp.user} onChange={(e) => updateSmtp({ user: e.target.value })} autoComplete="off" />
            </label>
            <label style={styles.field}>
              <span>Password</span>
              <div style={styles.passWrap}>
                <input
                  style={styles.input}
                  type={showPass ? "text" : "password"}
                  value={smtp.pass}
                  onChange={(e) => updateSmtp({ pass: e.target.value })}
                  autoComplete="new-password"
                  placeholder="留空保持不变"
                />
                <button type="button" style={styles.eye} onClick={() => setShowPass((v) => !v)}>
                  {showPass ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
          </div>
        </fieldset>

        <div style={styles.row}>
          <label style={styles.field}>
            <span>From</span>
            <input style={styles.input} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="sender@example.com" />
          </label>
          <label style={styles.field}>
            <span>To</span>
            <input style={styles.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="receiver@example.com" />
          </label>
        </div>

        <label style={styles.field}>
          <span>主题前缀</span>
          <input style={styles.input} value={subjectPrefix} onChange={(e) => setSubjectPrefix(e.target.value)} />
        </label>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>通知事件</legend>
          {(Object.keys(EVENT_LABELS) as NotifyEventType[]).map((key) => (
            <label key={key} style={styles.checkRow}>
              <input
                type="checkbox"
                checked={events[key]}
                onChange={(e) => setEvents((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {EVENT_LABELS[key]}
            </label>
          ))}
        </fieldset>

        {(testResult || sendResult) && (
          <div
            style={{
              ...styles.testResult,
              color: (testResult ?? sendResult)!.ok ? RESULT_SUCCESS : RESULT_ERROR,
            }}
          >
            {(testResult ?? sendResult)!.ok ? "✓ " : "✗ "}
            {(testResult ?? sendResult)!.message}
          </div>
        )}

        <div style={styles.footer}>
          <button style={{ ...styles.button, ...styles.ghost }} onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </button>
          <button style={{ ...styles.button, ...styles.ghost }} onClick={handleSendTest} disabled={sendingTest}>
            {sendingTest ? "发送中..." : "发送测试邮件"}
          </button>
          <div style={styles.footerRight}>
            <button style={styles.buttonGhost} onClick={onClose}>取消</button>
            <button style={styles.buttonPrimary} onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
    width: 520,
    maxWidth: "92vw",
    maxHeight: "86vh",
    overflowY: "auto",
    boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 16, margin: 0 },
  close: { background: "none", border: "none", color: "inherit", fontSize: 22, cursor: "pointer" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, margin: "6px 0", fontSize: 14 },
  fieldset: { border: "1px solid var(--bg-hover, #333)", borderRadius: 8, padding: "10px 12px", margin: "10px 0" },
  legend: { fontSize: 13, padding: "0 4px", color: "var(--text-muted, #999)" },
  row: { display: "flex", gap: 10 },
  field: { display: "flex", flexDirection: "column", gap: 4, flex: 1, fontSize: 12, marginBottom: 8 },
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
  passWrap: { position: "relative" },
  testResult: {
    marginTop: 12,
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(0,0,0,0.06)",
    fontSize: 13,
    lineHeight: 1.4,
  },
  eye: {
    position: "absolute",
    right: 6,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    color: "var(--text-muted, #999)",
    cursor: "pointer",
    fontSize: 12,
  },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  footerRight: { display: "flex", gap: 8 },
  button: { padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, border: "none" },
  buttonGhost: {
    padding: "7px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    background: "none",
    border: "1px solid var(--bg-hover, #333)",
    color: "var(--text, #e8e8e8)",
  },
  buttonPrimary: {
    padding: "7px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    background: "var(--accent, #60a5fa)",
    color: "#0b0f14",
    border: "none",
    fontWeight: 600,
  },
  ghost: {
    background: "none",
    border: "1px solid var(--bg-hover, #333)",
    color: "var(--text, #e8e8e8)",
  },
};
