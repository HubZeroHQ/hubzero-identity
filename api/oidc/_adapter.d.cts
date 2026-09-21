import type { IncomingMessage, ServerResponse } from "node:http";

export function handleVercelOidcRoute(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void>;
export function resolveVercelAuthorizationRoute(requestUrl: string | undefined): { pathname: string; requestUrl: string };
