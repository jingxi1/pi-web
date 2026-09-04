/**
 * Types, defaults and validation for the email notification system.
 * The on-disk config lives at ~/.pi/agent/notify.json and never returns the SMTP
 * password to the client (see stripPassword).
 */

export type NotifyEventType = "agentEnd" | "error" | "inputNeeded";

export interface NotifySmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface NotifyConfig {
  enabled: boolean;
  smtp: NotifySmtpConfig;
  from: string;
  to: string;
  subjectPrefix: string;
  events: Record<NotifyEventType, boolean>;
}

/** Config as returned to the client — the SMTP password is always stripped. */
export type NotifyConfigWithoutPassword = Omit<NotifyConfig, "smtp"> & {
  smtp: Omit<NotifySmtpConfig, "pass">;
};

export const DEFAULT_NOTIFY_EVENTS: Record<NotifyEventType, boolean> = {
  agentEnd: true,
  error: true,
  inputNeeded: true,
};

export const DEFAULT_SMTP: NotifySmtpConfig = {
  host: "",
  port: 465,
  secure: true,
  user: "",
  pass: "",
};

export function defaultNotifyConfig(): NotifyConfig {
  return {
    enabled: false,
    smtp: { ...DEFAULT_SMTP },
    from: "",
    to: "",
    subjectPrefix: "[pi-tools]",
    events: { ...DEFAULT_NOTIFY_EVENTS },
  };
}

/** Fill missing fields from defaults. */
export function mergeWithDefaults(input: Partial<NotifyConfig> | null | undefined): NotifyConfig {
  const base = defaultNotifyConfig();
  if (!input) return base;
  return {
    ...base,
    ...input,
    smtp: { ...base.smtp, ...(input.smtp ?? {}) },
    events: { ...base.events, ...(input.events ?? {}) },
  };
}

/** Remove the SMTP password before sending the config to the client. */
export function stripPassword(config: NotifyConfig): NotifyConfigWithoutPassword {
  const { pass: _pass, ...smtp } = config.smtp;
  return { ...config, smtp };
}

/** Validate a config; returns an error message string, or null when valid. */
export function validateNotifyConfig(config: NotifyConfig): string | null {
  if (!config.enabled) return null;
  if (!config.smtp.host) return "SMTP host is required";
  if (!Number.isInteger(config.smtp.port) || config.smtp.port <= 0 || config.smtp.port > 65535) {
    return "SMTP port must be a valid number (1-65535)";
  }
  if (!config.smtp.user) return "SMTP username is required";
  if (!config.from) return "From address is required";
  if (!config.to) return "To address is required";
  return null;
}
