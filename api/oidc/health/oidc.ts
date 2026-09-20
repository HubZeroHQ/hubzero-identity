import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelOidcRoute } from "../../../src/lib/oidc/vercel-adapter";
const handler = (request: IncomingMessage, response: ServerResponse) => handleVercelOidcRoute(request, response, "/health/oidc");
export default handler;
