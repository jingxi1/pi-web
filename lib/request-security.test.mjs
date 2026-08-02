import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  })), true);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { host: "localhost:30141" },
  })), true);
});

test("allows LAN same-origin requests when Next.js uses an internal localhost URL", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), true);
});

test("allows IPv6 and an explicitly configured hostname", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const ipv6 = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "[::1]:30141",
      origin: "http://[::1]:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  const configured = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "pi-web.internal:30141",
      origin: "http://pi-web.internal:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(ipv6), true);
  assert.equal(isApiRequestAllowed(configured, ["pi-web.internal"]), true);
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });
  const crossSiteGet = new Request("http://localhost:30141/api/sessions", {
    headers: { host: "localhost:30141", "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestAllowed(crossSiteGet), false);
});

test("rejects an origin that does not match the external request host", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects DNS rebinding even when browser headers say same-origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/skills/install", {
    method: "POST",
    headers: {
      host: "attacker.example:30141",
      origin: "http://attacker.example:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects missing, malformed, and unconfigured Host headers", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test")), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "localhost@attacker.example:30141" },
  })), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "pi-web.internal:30141" },
  })), false);
});

test("recognizes JSON request content types", async () => {
  const { hasJsonContentType } = await loadSubject();
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/json; charset=utf-8" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/problem+json" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "text/plain" },
  })), false);
});

test("allows wildcard subdomain hosts from built-in defaults", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Single-label subdomain matches the *.appvmm.fnos.net default.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "foo.appvmm.fnos.net:30141" },
  })), true);
  // Multi-label subdomain also matches (e.g. tailscale-funnel style hostnames).
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "a.b.appvmm.fnos.net:30141" },
  })), true);
});

test("rejects bare apex and unrelated hosts even with wildcard defaults present", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Use explicit patterns (no `.fnos.net` catch-all) so this test isolates
  // the bare-apex rejection of `*.appvmm.fnos.net`.
  const patterns = ["*.appvmm.fnos.net"];
  // The bare apex does not match *.appvmm.fnos.net.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "appvmm.fnos.net:30141" },
  }), patterns), false);
  // Unrelated hostname must not be allowed.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "attacker.example:30141" },
  }), patterns), false);
});

test("supports wildcard patterns from PI_WEB_ALLOWED_HOSTS env", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  const patterns = ["*.lan.local", "*.appvmm.fnos.net", "pi-web.internal"];
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "dev.lan.local:30141" },
  }), patterns), true);
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "x.y.lan.local:30141" },
  }), patterns), true);
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "pi-web.internal:30141" },
  }), patterns), true);
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "lan.local:30141" },
  }), patterns), false);
});

test("rejects host that only shares the suffix but is not a real subdomain", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Use explicit patterns (no `.fnos.net` wildcard) so this test isolates
  // the `*.appvmm.fnos.net` suffix-check behavior from any broader catch-all.
  const patterns = ["*.appvmm.fnos.net"];
  // "notappvmm.fnos.net" must NOT match "*.appvmm.fnos.net" because the
  // preceding char is not a "." separator.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "notappvmm.fnos.net:30141" },
  }), patterns), false);
});

test("supports '.example.com' (apex + subdomains) syntax", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  const patterns = [".lan.local"];
  // Apex is allowed.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "lan.local:30141" },
  }), patterns), true);
  // Subdomains allowed.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "foo.lan.local:30141" },
  }), patterns), true);
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "a.b.lan.local:30141" },
  }), patterns), true);
  // Suffix-only trick still rejected.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "notlan.local:30141" },
  }), patterns), false);
});

test("'.home977.fnos.net' default allows the apex and any subdomain", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Apex
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "home977.fnos.net:30141" },
  })), true);
  // Subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "nas.home977.fnos.net:30141" },
  })), true);
  // Multi-level subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "foo.bar.home977.fnos.net:30141" },
  })), true);
});

test("'.fnos.net' default allows the apex and any subdomain (incl. multi-level)", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Apex
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "fnos.net:30141" },
  })), true);
  // Single-level subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "appvmm.fnos.net:30141" },
  })), true);
  // Two-level subdomain (xxx.xxx.fnos.net)
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "pi.foo.fnos.net:30141" },
  })), true);
  // Three-level subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "a.b.c.fnos.net:30141" },
  })), true);
  // Unrelated domain must still be rejected
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "fnos.net.evil.example:30141" },
  })), false);
});

test("'.5ddd.com' default allows the apex and any subdomain (incl. multi-level)", async () => {
  const { isApiRequestHostAllowed } = await loadSubject();
  // Apex
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "5ddd.com:30141" },
  })), true);
  // Single-level subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "app.5ddd.com:30141" },
  })), true);
  // Two-level subdomain
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "pi.foo.5ddd.com:30141" },
  })), true);
  // Suffix-only trick rejected
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "5ddd.com.evil.example:30141" },
  })), false);
});

test("isApiRequestOriginAllowed matches HTTPS origin via X-Forwarded-Proto when app is HTTP behind a reverse proxy", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  // User accessed the app at https://foo.appvmm.fnos.net (HTTPS), but pi-tools
  // itself listens on plain HTTP behind the proxy. The proxy sets
  // X-Forwarded-Proto: https and forwards the original Host. Origin must match.
  const request = new Request("http://0.0.0.0:30141/api/test", {
    method: "POST",
    headers: {
      host: "foo.appvmm.fnos.net",
      origin: "https://foo.appvmm.fnos.net",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), true);
});

test("isApiRequestOriginAllowed uses leftmost X-Forwarded-Proto in a multi-proxy chain", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  // Original client was on HTTPS, then http, then https again (multi-hop).
  // The leftmost value (the original client) wins.
  const request = new Request("http://0.0.0.0:30141/api/test", {
    method: "POST",
    headers: {
      host: "foo.appvmm.fnos.net",
      origin: "https://foo.appvmm.fnos.net",
      "x-forwarded-proto": "https, http, https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), true);
});

test("isApiRequestOriginAllowed still rejects when X-Forwarded-Proto is spoofed to a non-matching value", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  // Direct access (no proxy). request.url is http, no X-Forwarded-Proto.
  // Origin is https — must NOT match, otherwise the app silently trusts the
  // (absent) header. With no X-Forwarded-Proto we fall back to request.url's
  // protocol (http), so https Origin mismatches and is rejected.
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "https://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), false);
});
