import { createServer } from "node:http";
import next from "next";
import { parseEnvironment } from "./src/lib/env";
import { getOidcProvider } from "./src/lib/oidc/provider";
import { handleIdentityNodeRequest } from "./src/lib/oidc/node-handler";

/**
 * Portable Node/Docker entrypoint only. Vercel uses fixed `api/oidc/*` Node
 * Functions with the same handler instead of starting this listener.
 */
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const environment = parseEnvironment(process.env);
const application = next({ dev: environment.APP_ENV === "development", hostname: "127.0.0.1", port });

async function main() {
  await application.prepare();
  // Fail early for the portable deployment shape. The Vercel readiness route
  // performs the equivalent check without assuming a process lifecycle.
  const oidc = environment.OIDC_PROVIDER_ENABLED ? await getOidcProvider() : null;
  const server = createServer(async (request, response) => {
    const handled = await handleIdentityNodeRequest(request, response, environment);
    if (!handled) application.getRequestHandler()(request, response);
  });
  server.listen(port, "0.0.0.0", () => console.info(`HubZero Identity listening on port ${port}`));
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    server.close(async () => {
      await oidc?.runtime.client.close().catch(() => undefined);
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("HubZero Identity could not start", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
