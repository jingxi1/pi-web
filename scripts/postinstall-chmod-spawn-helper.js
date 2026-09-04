// Postinstall hook: on POSIX, make the repo's shell scripts executable so
// docker-entrypoint.sh / build-and-push.sh / sync.sh can be run directly.
// No-op on Windows (chmod is a no-op for +x).
"use strict";
const { chmodSync, existsSync, readdirSync } = require("fs");
const { join } = require("path");

if (process.platform === "win32") {
  process.exit(0);
}

const root = join(__dirname, "..");
const targets = ["docker-entrypoint.sh", "build-and-push.sh", "sync.sh"];

for (const t of targets) {
  const p = join(root, t);
  if (existsSync(p)) {
    try {
      chmodSync(p, 0o755);
    } catch {
      /* best effort */
    }
  }
}
process.exit(0);
