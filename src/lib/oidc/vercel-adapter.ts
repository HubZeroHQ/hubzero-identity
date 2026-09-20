import type { IncomingMessage, ServerResponse } from "node:http";
import { parseEnvironment } from "@/lib/env";
import { handleIdentityNodeRequest } from "@/lib/oidc/node-handler";

/** Adapts a fixed Vercel Node Function route to its canonical issuer path. */
export async function handleVercelOidcRoute(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const originalUrl = request.url;
  const url = new URL(originalUrl ?? "/", "https://internal.hubzero.invalid");
  request.url = `${pathname}${url.search}`;
  try {
    const handled = await handleIdentityNodeRequest(request, response, parseEnvironment(process.env));
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
