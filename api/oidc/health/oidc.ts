import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
const { handleVercelOidcRoute } = createRequire(import.meta.url)("../../../dist/vercel-oidc/adapter.cjs") as { handleVercelOidcRoute(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> };
const handler = (request: IncomingMessage, response: ServerResponse) => handleVercelOidcRoute(request, response, "/health/oidc");
export default handler;
