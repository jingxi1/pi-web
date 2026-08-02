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
  // The bare apex does not match *.appvmm.fnos.net.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "appvmm.fnos.net:30141" },
  })), false);
  // Unrelated hostname must not be allowed.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "attacker.example:30141" },
  })), false);
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
  // e.g. "notappvmm.fnos.net" must NOT match "*.appvmm.fnos.net" because the
  // preceding char is not a "." separator.
  assert.equal(isApiRequestHostAllowed(new Request("http://localhost/api/test", {
    headers: { host: "notappvmm.fnos.net:30141" },
  })), false);
});
