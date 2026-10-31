import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelOidcRoute } from "../_adapter.cjs";

/**
 * `/health/live` shares this Function to stay within the Hobby Function limit.
 * Liveness deliberately proves only that this Vercel Node Function can answer.
 */
const handler = (request: IncomingMessage, response: ServerResponse) => {
  if (new URL(request.url ?? "/", "https://internal.hubzero.invalid").searchParams.get("probe") === "live") {
    response.statusCode = 204;
    response.end();
    return;
  }
  return handleVercelOidcRoute(request, response, "/health/oidc");
};
export default handler;
