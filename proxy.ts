import { NextResponse, type NextRequest } from "next/server";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";

// Trust domain check removed 2026-08-28 by Q (user request "走A").
// Upstream v0.8.11 added isApiRequestAllowed / isApiRequestHostAllowed via
// proxy.ts; those gate browser requests on Origin + sec-fetch-site and were
// blocking UI access to /api (model panel etc.) from non-allowlist hostnames
// while CLI/SDK calls (no Origin header) still worked. We keep only the
// optional Basic Auth gate below.
export function proxy(request: NextRequest) {
  const password = process.env.PI_WEB_PASSWORD;
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
