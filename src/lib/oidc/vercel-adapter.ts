import type { IncomingMessage, ServerResponse } from "node:http";
import { parseEnvironment } from "@/lib/env";
import { handleIdentityNodeRequest } from "@/lib/oidc/node-handler";

/** Adapts a fixed Vercel Node Function route to its canonical issuer path. */
export async function handleVercelOidcRoute(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const originalUrl = request.url;
  const url = new URL(originalUrl ?? "/", "https://internal.hubzero.invalid");
  request.url = `${pathname}${url.search}`;
  try {
    const environment = parseEnvironment(process.env);
    // Vercel terminates TLS before the Node Function. Never propagate an
    // untrusted forwarding header into oidc-provider: normalize the values
    // from the configured, fixed issuer after the Node handler has performed
    // its raw Host validation.
    const issuer = new URL(environment.IDENTITY_ISSUER_URL);
    request.headers["x-forwarded-proto"] = issuer.protocol.slice(0, -1);
    request.headers["x-forwarded-host"] = issuer.host;
    const handled = await handleIdentityNodeRequest(request, response, environment, { trustedProxyHeaders: true });
    if (!handled && !response.headersSent) {
      response.statusCode = 404;
      response.end("Not found");
    }
  } finally {
    request.url = originalUrl;
  }
}

export function canonicalVercelOidcPath(pathname: string, requestUrl: string | undefined): string {
  return `${pathname}${new URL(requestUrl ?? "/", "https://internal.hubzero.invalid").search}`;
}

/**
 * Vercel's dynamic rewrite transports `/authorize/:uid` as the fixed
 * authorize Function plus `?uid=…`. Restore the provider route while keeping
 * that implementation-only query parameter out of oidc-provider's request
 * parser. A caller-supplied malformed uid remains an ordinary invalid
 * authorization parameter rather than becoming a path.
 */
export function resolveVercelAuthorizationRoute(requestUrl: string | undefined): { pathname: string; requestUrl: string } {
  const url = new URL(requestUrl ?? "/api/oidc/authorize", "https://internal.hubzero.invalid");
  const uid = url.searchParams.get("uid");
  if (!uid || !/^[A-Za-z0-9_-]{16,160}$/.test(uid)) return { pathname: "/authorize", requestUrl: `${url.pathname}${url.search}` };
  url.searchParams.delete("uid");
  return { pathname: `/authorize/${uid}`, requestUrl: `${url.pathname}${url.search}` };
}
