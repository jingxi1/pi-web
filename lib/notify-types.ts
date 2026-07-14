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

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  enabled: false,
  smtp: {
    host: "",
    port: 465,
    secure: true,
    user: "",
    pass: "",
  },
  from: "",
  to: "",
  subjectPrefix: "[pi-web]",
  events: {
    agentEnd: true,
    error: true,
    inputNeeded: true,
  },
};

export type NotifyConfigWithoutPassword = Omit<NotifyConfig, "smtp"> & {
  smtp: Omit<NotifySmtpConfig, "pass">;
};

export function validateNotifyConfig(config: NotifyConfig): string | null {
  if (!config.enabled) return null;
  if (!config.smtp.host) return "SMTP host is required";
  if (!config.smtp.port) return "SMTP port is required";
  if (!config.from) return "From address is required";
  if (!config.to) return "To address is required";
  return null;
}

export function mergeWithDefaults(partial: Partial<NotifyConfig>): NotifyConfig {
  return {
    ...DEFAULT_NOTIFY_CONFIG,
    ...partial,
    smtp: { ...DEFAULT_NOTIFY_CONFIG.smtp, ...(partial.smtp ?? {}) },
    events: { ...DEFAULT_NOTIFY_CONFIG.events, ...(partial.events ?? {}) },
  };
}

export function stripPassword(config: NotifyConfig): NotifyConfigWithoutPassword {
  const { smtp, ...rest } = config;
  const { pass, ...smtpRest } = smtp;
  void pass;
  return { ...rest, smtp: smtpRest };
}
