import { NextRequest, NextResponse } from "next/server";
import { isIdentityNodeRoute } from "@/lib/oidc/routes";
import { contentSecurityPolicy, isAcceptedHost } from "@/lib/security/request-policy";

export function proxy(request: NextRequest) {
  if (!isAcceptedHost(request.headers.get("host"), process.env)) {
    return new NextResponse("Misdirected request", { status: 421, headers: { "Cache-Control": "no-store" } });
  }
  // The Node bridge owns these responses and their security headers; on Vercel
  // the path may already be rewritten to its function.
  const path = request.nextUrl.pathname;
  if (isIdentityNodeRoute(path) || path.startsWith("/api/oidc/")) return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the nonce from this request header.
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Prefetch requests stay in scope: excluding them by header would let any
// client skip the host check by sending that header.
export const config = {
  matcher: "/((?!_next/static/).*)",
};
