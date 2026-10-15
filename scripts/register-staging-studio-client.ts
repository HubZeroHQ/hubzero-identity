import { MongoClient, ObjectId } from "mongodb";
import { parseArgs } from "node:util";
import { identityApplicationsCollection } from "../src/lib/db/collections";
import type { ApplicationDocument } from "../src/lib/db/documents";
import { STAGING_IDENTITY_DATABASE } from "../src/lib/env";
import { planStagingStudioClient } from "../src/lib/oidc/staging-client";

/**
 * Registers the dedicated Studio test client in the isolated staging Identity
 * database (plan PRE-07). It never reads the regular MONGODB_URI, refuses any
 * database but hubzero_identity_staging, and proves the credential can write
 * only that database before any write. It prints no secret.
 *
 *   IDENTITY_STAGING_MONGODB_URI=... npx tsx scripts/register-staging-studio-client.ts \
 *     --issuer https://<staging issuer> --client-id hubzero-studio-<name> \
 *     --callback https://<preview alias>/studio/oidc/callback --secret-reference studio-<name> \
 *     --confirm-staging-only
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    issuer: { type: "string" },
    "client-id": { type: "string" },
    callback: { type: "string" },
    "secret-reference": { type: "string" },
    "confirm-staging-only": { type: "boolean" },
  }, strict: true });
  if (!values["confirm-staging-only"]) throw new Error("--confirm-staging-only is required");

  const uri = process.env.IDENTITY_STAGING_MONGODB_URI;
  if (!uri) throw new Error("IDENTITY_STAGING_MONGODB_URI is required; no runtime or production fallback exists");
  let database: string;
  try { database = decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, "")); } catch { throw new Error("IDENTITY_STAGING_MONGODB_URI is malformed"); }

  const plan = planStagingStudioClient({
    issuer: values.issuer ?? "",
    database,
    clientId: values["client-id"] ?? "",
    callback: values.callback ?? "",
    secretReference: values["secret-reference"] ?? "",
  });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
    const roles = status.authInfo?.authenticatedUserRoles;
    if (!Array.isArray(roles) || roles.length !== 1 || roles[0]?.role !== "readWrite" || roles[0]?.db !== STAGING_IDENTITY_DATABASE) {
      throw new Error(`The credential must hold only readWrite@${STAGING_IDENTITY_DATABASE}`);
    }
    const applications = identityApplicationsCollection(client.db(STAGING_IDENTITY_DATABASE));
    const existing = await applications.find({ $or: [{ id: plan.applicationId as never }, { clientId: plan.clientId }] }).toArray();
    if (existing.length > 0) {
      const current = existing[0];
      if (existing.length !== 1 || current.clientId !== plan.clientId || current.clientSecretReference !== plan.secretReference
        || current.redirectUris.length !== 1 || current.redirectUris[0] !== plan.callback || !current.enabled) {
        throw new Error("An existing staging application conflicts with the requested client");
      }
      process.stdout.write(JSON.stringify({ database: STAGING_IDENTITY_DATABASE, clientId: plan.clientId, status: "already-registered", writes: 0 }) + "\n");
      return;
    }
    const now = new Date();
    const application: ApplicationDocument = {
      _id: new ObjectId(), id: plan.applicationId as never, slug: plan.applicationId,
      displayName: "HubZero Studio (isolated test)", description: "Isolated Studio OIDC test client; never production",
      clientId: plan.clientId, clientType: "confidential_web", clientSecretReference: plan.secretReference,
      visibility: "internal", redirectUris: [plan.callback], postLogoutRedirectUris: [],
      firstParty: true, enabled: true, brand: { homeUrl: new URL(plan.callback).origin + "/studio", mark: "S" },
      createdAt: now, updatedAt: now,
    };
    await applications.insertOne(application);
    process.stdout.write(JSON.stringify({ database: STAGING_IDENTITY_DATABASE, clientId: plan.clientId, status: "registered", writes: 1 }) + "\n");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Staging client registration failed"}; no secret values emitted\n`);
  process.exitCode = 1;
});
