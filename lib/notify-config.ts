import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDataDir } from "./agent-data-dir";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { mergeWithDefaults, type NotifyConfig } from "./notify-types";

export function getNotifyConfigPath(): string {
  return join(getAgentDataDir(), "notify.json");
}

/** Read the on-disk notify config, falling back to defaults on any error. */
export function readNotifyConfig(): NotifyConfig {
  try {
    const raw = readFileSync(getNotifyConfigPath(), "utf8");
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return mergeWithDefaults({});
  }
}

/** Persist the notify config atomically (0600 perms). */
export function writeNotifyConfig(config: NotifyConfig): void {
  mkdirSync(getAgentDataDir(), { recursive: true });
  writePrivateFileAtomicSync(getNotifyConfigPath(), JSON.stringify(config, null, 2));
}
