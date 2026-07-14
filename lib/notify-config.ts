import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type NotifyConfig,
  DEFAULT_NOTIFY_CONFIG,
  mergeWithDefaults,
} from "./notify-types";

const NOTIFY_FILE = "notify.json";

function getNotifyPath(): string {
  return join(getAgentDir(), NOTIFY_FILE);
}

export async function readNotifyConfig(): Promise<NotifyConfig> {
  try {
    const raw = await readFile(getNotifyPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<NotifyConfig>;
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_NOTIFY_CONFIG };
  }
}

export async function writeNotifyConfig(config: NotifyConfig): Promise<void> {
  const dir = getAgentDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // already exists
  }
  await writeFile(getNotifyPath(), JSON.stringify(config, null, 2), "utf-8");
}
