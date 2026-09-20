import type { IncomingMessage, ServerResponse } from "node:http";

/** Liveness deliberately proves only that this Vercel Node Function can answer. */
const handler = (_request: IncomingMessage, response: ServerResponse) => {
  response.statusCode = 204;
  response.end();
};
export default handler;
