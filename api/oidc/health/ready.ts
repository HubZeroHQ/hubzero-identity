import type { IncomingMessage, ServerResponse } from "node:http";
// Keep the full native credential closure in the readiness function. The
// handler validates it through PasswordService before reporting healthy.
import "argon2";
import "bcrypt";
import { handleVercelOidcRoute } from "../_adapter.cjs";
const handler = (request: IncomingMessage, response: ServerResponse) => handleVercelOidcRoute(request, response, "/health/ready");
export default handler;
