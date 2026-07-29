import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

const { version: piToolsVersion } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// 上游版本（agegr/pi-web main 分支的 package.json version）。
// 用来在 UI 里区分"Pi Web"（上游）vs"Pi Tools"（本 fork）。
// 无网络/无 upstream remote 时优雅降级为 "unknown"，不要让 build 挂掉。
let piWebVersion = "unknown";
try {
  const raw = execFileSync(
    "git",
    ["show", "upstream/main:package.json"],
    { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
  ).toString();
  const parsed = JSON.parse(raw) as { version?: string };
  if (typeof parsed.version === "string" && parsed.version) {
    piWebVersion = parsed.version;
  }
} catch { /* no upstream remote or offline — fall back to "unknown" */ }

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "node-pty",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: piToolsVersion,
    NEXT_PUBLIC_PIWEB_VERSION: piWebVersion,
    NEXT_PUBLIC_PI_TOOLS_VERSION: piToolsVersion,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
