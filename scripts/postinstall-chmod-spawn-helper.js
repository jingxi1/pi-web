#!/usr/bin/env node
// Postinstall: ensure node-pty spawn-helper is executable on every platform.
// npm's tar extraction doesn't preserve +x for prebuilt binaries, which makes
// PTY.spawn fail silently on macOS/Linux ("posix_spawnp: No such file or
// directory"). Doing it from a script rather than a shell hook keeps the
// syntax portable across macOS / Linux / Windows (where spawn-helper
// doesn't exist, so we just no-op).
const { execSync } = require("child_process");

try {
  // Cross-platform: find any spawn-helper under node-pty/prebuilds and chmod +x.
  // find is GNU on Linux and BSD on macOS, both accept the same flags here.
  execSync(
    'find node_modules/node-pty/prebuilds -name spawn-helper -type f -exec chmod +x {} +',
    { stdio: "ignore" }
  );
} catch {
  // node-pty isn't installed (e.g. optionalDependencies skipped on this arch)
  // — silently no-op so we don't fail the install.
}
