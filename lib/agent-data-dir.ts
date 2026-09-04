import os from "os";
import { join } from "path";

/**
 * Base directory for all PiTools agent data (~/.pi/agent by default).
 * `PI_CODING_AGENT_DIR` overrides the whole directory (see docs §28), which
 * also lets tests isolate on-disk stores into a temp directory.
 */
export function getAgentDataDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(os.homedir(), ".pi", "agent");
}
