import { isIP } from "node:net";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

/**
 * Built-in trusted host patterns applied to every deployment. Use these for
 * fork-wide defaults that should not require per-machine env overrides.
 *
 * Supported pattern syntaxes (see `matchesHostPattern` for details):
 * - `example.com`     — exact match (apex only)
 * - `*.example.com`   — any non-empty subdomain (multi-level OK), not the apex
 * - `.example.com`    — apex AND any subdomain (Pi-hole/NextDNS/AdGuard style)
 */
const DEFAULT_ALLOWED_HOST_PATTERNS: readonly string[] = [
  "*.appvmm.fnos.net",
  ".home977.fnos.net",
];

/**
 * Matches a request hostname against a configured host pattern.
 *
 * - `*.example.com` matches any subdomain of `example.com` (multi-level OK),
 *   but not the bare apex `example.com`.
 * - `.example.com` matches the apex AND any subdomain. This is the
 *   Pi-hole/NextDNS/AdGuard convention for "this domain and everything
 *   under it" and is the most common allowlist shape for whole-home
 *   Tailscale-style hostnames like `.home977.fnos.net`.
 * - Any other pattern is compared as an exact (case-insensitive) match.
 *
 * Patterns are intentionally not run through `hostnameFromAuthority`/`URL`
 * parsing: the leading `*` and `.` are not valid URI hostname characters,
 * so URL-based normalization would either reject the pattern or rewrite it.
 */
function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  if (pattern.startsWith(".") && pattern.length > 1) {
    const suffix = pattern; // ".example.com"
    return hostname === suffix.slice(1) || // apex
      (hostname.endsWith(suffix) && hostname.length > suffix.length);
  }
  return hostname === pattern;
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    ...DEFAULT_ALLOWED_HOST_PATTERNS,
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestUrl.protocol}//${host}`) : null;
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) {
    return false;
  }

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configuredHostnames.some((configured) => {
    const trimmed = configured.trim();
    if (!trimmed) return false;
    return matchesHostPattern(hostname, trimmed);
  });
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  return requestOrigin !== null && canonicalOrigin(origin) === requestOrigin;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
