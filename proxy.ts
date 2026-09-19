import { NextRequest, NextResponse } from "next/server";

function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    development ? "script-src 'self' 'unsafe-eval'" : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const configuredOrigin = process.env.IDENTITY_ISSUER_URL;
  if (process.env.APP_ENV === "production" && configuredOrigin) {
    const expectedHost = new URL(configuredOrigin).host;
    if (request.headers.get("host") !== expectedHost) return new NextResponse("Misdirected request", { status: 421 });
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
