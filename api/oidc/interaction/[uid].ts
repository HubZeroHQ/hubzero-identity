import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelOidcRoute } from "../../../src/lib/oidc/vercel-adapter";
const handler = (request: IncomingMessage, response: ServerResponse) => handleVercelOidcRoute(request, response, `/interaction/${String((request as IncomingMessage & { query?: { uid?: string } }).query?.uid ?? "")}`);
export default handler;
