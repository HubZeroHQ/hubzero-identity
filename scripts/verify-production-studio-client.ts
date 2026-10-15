import { MongoClient } from "mongodb";
import { identityApplicationsCollection } from "../src/lib/db/collections";
import { assessProductionStudioClient } from "../src/lib/oidc/staging-client";

/**
 * PRE-10: read-only, boolean-only evidence that production Studio signs in with
 * client `hubzero-studio`. Reads only `IDENTITY_READ_MONGODB_URI`, refuses any
 * credential that is not exactly `read@hubzero_identity`, reads only the
 * applications registry, and prints three booleans. Run only with operator
 * authorization; it never writes and never prints a configuration value.
 */
async function main(): Promise<void> {
  const uri = process.env.IDENTITY_READ_MONGODB_URI;
  if (!uri) throw new Error("IDENTITY_READ_MONGODB_URI is required; no runtime fallback exists");
  let database: string;
  try { database = decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, "")); } catch { throw new Error("IDENTITY_READ_MONGODB_URI is malformed"); }
  if (database !== "hubzero_identity") throw new Error("IDENTITY_READ_MONGODB_URI must target hubzero_identity");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
    const roles = status.authInfo?.authenticatedUserRoles;
    if (!Array.isArray(roles) || roles.length !== 1 || roles[0]?.role !== "read" || roles[0]?.db !== "hubzero_identity") {
      throw new Error("The credential must hold only read@hubzero_identity");
    }
    const applications = await identityApplicationsCollection(client.db("hubzero_identity"))
      .find({}, { projection: { _id: 0, clientId: 1, enabled: 1, redirectUris: 1, clientType: 1, clientSecretReference: 1 } })
      .toArray();
    process.stdout.write(JSON.stringify(assessProductionStudioClient(applications)) + "\n");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Verification failed"}; no configuration values emitted\n`);
  process.exitCode = 1;
});
