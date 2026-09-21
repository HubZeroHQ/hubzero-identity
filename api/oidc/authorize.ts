import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelOidcRoute, resolveVercelAuthorizationRoute } from "./_adapter.cjs";

const handler = (request: IncomingMessage, response: ServerResponse) => {
  const route = resolveVercelAuthorizationRoute(request.url);
  request.url = route.requestUrl;
  return handleVercelOidcRoute(request, response, route.pathname);
};
export default handler;
