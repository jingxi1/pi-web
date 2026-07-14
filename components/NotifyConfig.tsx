"use client";

import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { NotifyConfig, NotifyEventType } from "@/lib/notify-types";

const EVENT_LABELS: Record<NotifyEventType, string> = {
  agentEnd: "Task completed",
  error: "Task error",
  inputNeeded: "Waiting for input",
};

const EVENT_DESCRIPTIONS: Record<NotifyEventType, string> = {
  agentEnd: "Notify when an agent run finishes successfully",
  error: "Notify when a command or agent run fails",
  inputNeeded: "Notify when the agent asks for user input",
};

function SecretTextInput({
  label,
  value,
  onChange,
  placeholder,
  hasStoredValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hasStoredValue?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        <input
          type={revealed ? "text" : "password"}
          value={hasStoredValue && !revealed ? "••••••••" : value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (hasStoredValue) setRevealed(true); }}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
            fontFamily: "var(--font-mono)",
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
          }}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? "Hide" : "Show"}
          style={{
            padding: "0 10px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderLeft: "none",
            borderRadius: 6,
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export function NotifyConfig({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<NotifyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localPass, setLocalPass] = useState("");
  const [hasStoredPass, setHasStoredPass] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notify");
      const data = await res.json() as NotifyConfig & { error?: string; smtp: { pass?: string } };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfig(data);
      setHasStoredPass(false);
      setLocalPass("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const toSave: NotifyConfig = {
        ...config,
        smtp: {
          ...config.smtp,
          pass: localPass,
        },
      };
      const res = await fetch("/api/notify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      const data = await res.json() as NotifyConfig & { error?: string; smtp: { pass?: string } };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfig(data);
      setHasStoredPass(Boolean(toSave.smtp.pass));
      setLocalPass("");
      setSuccess("Saved");
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [config, localPass]);

  const handleTest = useCallback(async () => {
    if (!config) return;
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/notify/test", { method: "POST" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuccess("Connection successful");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }, [config]);

  const updateConfig = (patch: Partial<NotifyConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...patch } : prev);
  };

  const updateSmtp = (patch: Partial<NotifyConfig["smtp"]>) => {
    setConfig((prev) => prev ? { ...prev, smtp: { ...prev.smtp, ...patch } } : prev);
  };

  const toggleEvent = (event: NotifyEventType) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: { ...prev.events, [event]: !prev.events[event] },
      };
    });
  };

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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: "var(--bg-panel)",
          borderRadius: 10,
          width: isMobile ? "92vw" : 520,
          maxHeight: isMobile ? "92vh" : "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px rgba(0,0,0,0.25)",
          border: "1px solid var(--border)",
        }}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            Email Notifications
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
            aria-label="Close"
          >×</button>
        </div>

        <div style={{ padding: "16px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {loading && (
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px" }}>
              Loading...
            </div>
          )}

          {error && (
            <div style={{
              padding: "8px 12px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              fontSize: 12,
              color: "#ef4444",
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: "8px 12px",
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: 6,
              fontSize: 12,
              color: "#22c55e",
            }}>
              {success}
            </div>
          )}

          {config && !loading && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                  Enable email notifications
                </div>
                <button
                  type="button"
                  onClick={() => updateConfig({ enabled: !config.enabled })}
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                    background: config.enabled ? "var(--accent)" : "var(--border)",
                    position: "relative",
                    transition: "background 0.15s",
                  }}
                  aria-pressed={config.enabled}
                >
                  <div style={{
                    position: "absolute",
                    top: 2,
                    left: config.enabled ? 20 : 2,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "white",
                    transition: "left 0.15s",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  }} />
                </button>
              </div>

              <div style={{
                opacity: config.enabled ? 1 : 0.4,
                pointerEvents: config.enabled ? "auto" : "none",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    SMTP Server
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Host</label>
                      <input
                        type="text"
                        value={config.smtp.host}
                        onChange={(e) => updateSmtp({ host: e.target.value })}
                        placeholder="smtp.qq.com"
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontSize: 13,
                          outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Port</label>
                      <input
                        type="number"
                        value={config.smtp.port}
                        onChange={(e) => updateSmtp({ port: parseInt(e.target.value) || 0 })}
                        placeholder="465"
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontSize: 13,
                          outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      id="smtp-secure"
                      checked={config.smtp.secure}
                      onChange={(e) => updateSmtp({ secure: e.target.checked })}
                    />
                    <label htmlFor="smtp-secure" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Use SSL/TLS (port 465)
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Username</label>
                      <input
                        type="text"
                        value={config.smtp.user}
                        onChange={(e) => updateSmtp({ user: e.target.value })}
                        placeholder="you@example.com"
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontSize: 13,
                          outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                    <SecretTextInput
                      label="Password"
                      value={localPass}
                      onChange={setLocalPass}
                      placeholder={hasStoredPass ? "(stored)" : "auth token or password"}
                      hasStoredValue={hasStoredPass}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Addresses
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>From</label>
                      <input
                        type="email"
                        value={config.from}
                        onChange={(e) => updateConfig({ from: e.target.value })}
                        placeholder="you@example.com"
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontSize: 13,
                          outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>To</label>
                      <input
                        type="email"
                        value={config.to}
                        onChange={(e) => updateConfig({ to: e.target.value })}
                        placeholder="you@example.com"
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text)",
                          fontSize: 13,
                          outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Subject prefix</label>
                    <input
                      type="text"
                      value={config.subjectPrefix}
                      onChange={(e) => updateConfig({ subjectPrefix: e.target.value })}
                      placeholder="[pi-web]"
                      style={{
                        padding: "6px 8px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text)",
                        fontSize: 13,
                        outline: "none",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Notification Events
                  </div>
                  {(Object.keys(EVENT_LABELS) as NotifyEventType[]).map((event) => (
                    <label key={event} style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      cursor: "pointer",
                    }}>
                      <input
                        type="checkbox"
                        checked={config.events[event]}
                        onChange={() => toggleEvent(event)}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                          {EVENT_LABELS[event]}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {EVENT_DESCRIPTIONS[event]}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
        }}>
          <button
            onClick={handleTest}
            disabled={testing || !config?.enabled}
            style={{
              padding: "6px 14px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: config?.enabled ? "var(--text-muted)" : "var(--text-dim)",
              cursor: testing || !config?.enabled ? "not-allowed" : "pointer",
              fontSize: 13,
              opacity: config?.enabled ? 1 : 0.5,
            }}
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
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
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !config}
            style={{
              padding: "6px 14px",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              color: "white",
              cursor: saving || !config ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
