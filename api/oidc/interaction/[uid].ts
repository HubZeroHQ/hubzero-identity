import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelOidcRoute } from "../_adapter.cjs";
const handler = (request: IncomingMessage, response: ServerResponse) => handleVercelOidcRoute(request, response, `/interaction/${String((request as IncomingMessage & { query?: { uid?: string } }).query?.uid ?? "")}`);
export default handler;
