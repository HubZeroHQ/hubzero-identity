import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { parseArgs } from "node:util";
import { identityApplicationsCollection } from "../src/lib/db/collections";
import { planIdentityIndexes } from "../src/lib/db/indexes";
import type { ApplicationDocument } from "../src/lib/db/documents";

const applicationId = "studio";
const clientId = "hubzero-studio";
const callback = "https://hubzero.in/studio/oidc/callback";
const secretReference = "studio-production";

function requiredUri(name: string, database: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; no runtime or rehearsal fallback exists`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is malformed`); }
  if (decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) !== database) throw new Error(`${name} targets an unexpected database`);
  return value;
}

async function checkedClient(uri: string, database: string): Promise<MongoClient> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
  const roles = status.authInfo?.authenticatedUserRoles;
  if (!Array.isArray(roles) || roles.length !== 1 || roles[0]?.role !== "readWrite" || roles[0]?.db !== database) {
    await client.close();
    throw new Error(`Credential requires only readWrite@${database}`);
  }
  return client;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    environment: { type: "string" },
    "confirm-production-client": { type: "boolean" },
    "confirm-secrets-configured": { type: "boolean" },
    "recovery-reference": { type: "string" },
  }, strict: true });
  if (values.environment !== "production" || !values["confirm-production-client"] || !values["confirm-secrets-configured"]) {
    throw new Error("Explicit production client and secret-configuration confirmations are required");
  }
  const reference = values["recovery-reference"];
  if (!reference || !/^phase7-preinfra-[0-9]{8}T[0-9]{6}Z$/.test(reference)) throw new Error("A verified pre-infrastructure recovery reference is required");
  const metadataPath = join(resolve(process.cwd(), "..", "..", "phase7-operator-backups"), reference, "recovery-metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { recoveryReference?: string; restoreVerified?: boolean };
  if (metadata.recoveryReference !== reference || metadata.restoreVerified !== true) throw new Error("Recovery reference has not passed isolated restore verification");
  const identityUri = requiredUri("IDENTITY_MIGRATION_MONGODB_URI", "hubzero_identity");
  const studioUri = requiredUri("STUDIO_MIGRATION_MONGODB_URI", "hubzero");
  const identityClient = await checkedClient(identityUri, "hubzero_identity");
  const studioClient = await checkedClient(studioUri, "hubzero");
  try {
    const identity = identityClient.db("hubzero_identity");
    const studio = studioClient.db("hubzero");
    if ((await planIdentityIndexes(identity)).create.length !== 0) throw new Error("Required Identity indexes are absent");
    const userIndexes = await studio.collection("users").listIndexes().toArray();
    const mappingIndex = userIndexes.find((index) => index.name === "uniq_identity_subject");
    if (!mappingIndex || JSON.stringify(mappingIndex.key) !== JSON.stringify({ identitySubject: 1 })
      || mappingIndex.unique !== true || mappingIndex.sparse !== true) {
      throw new Error("Required sparse unique Studio identitySubject index is absent or conflicting");
    }
    const handoffIndexes = await studio.collection("studioOidcHandoffs").listIndexes().toArray();
    if (!handoffIndexes.some((index) => index.name === "uniq_secret_hash" && index.unique === true)
      || !handoffIndexes.some((index) => index.name === "expire_handoffs" && index.expireAfterSeconds === 0)) {
      throw new Error("Required Studio OIDC handoff indexes are absent");
    }
    const counts = await Promise.all([
      studio.collection("users").countDocuments({}),
      studio.collection("users").countDocuments({ identitySubject: { $exists: true } }),
      identity.collection("identity_users").countDocuments({}),
      identity.collection("identity_credentials").countDocuments({}),
      identity.collection("identity_memberships").countDocuments({}),
      identity.collection("studio_migration_journal").countDocuments({}),
    ]);
    if (JSON.stringify(counts) !== JSON.stringify([5, 0, 0, 0, 0, 0])) throw new Error("Production account or migration state drifted");
    const applications = identityApplicationsCollection(identity);
    const existing = await applications.find({ $or: [{ id: applicationId as never }, { clientId }] }).toArray();
    if (existing.length > 0) {
      const current = existing[0];
      if (existing.length !== 1 || current.id !== applicationId || current.clientId !== clientId
        || current.clientType !== "confidential_web" || current.clientSecretReference !== secretReference
        || current.redirectUris.length !== 1 || current.redirectUris[0] !== callback
        || !current.firstParty || !current.enabled) {
        throw new Error("Production Studio application/client conflicts with the approved contract");
      }
      process.stdout.write(JSON.stringify({ database: "hubzero_identity", applicationId, clientId, callback, status: "already-registered", writes: 0 }) + "\n");
      return;
    }
    const now = new Date();
    const application: ApplicationDocument = {
      _id: new ObjectId(), id: applicationId as never, slug: applicationId,
      displayName: "HubZero Studio", description: "First-party HubZero Studio OIDC client",
      clientId, clientType: "confidential_web", clientSecretReference: secretReference,
      visibility: "internal", redirectUris: [callback], postLogoutRedirectUris: [],
      firstParty: true, enabled: true, brand: { homeUrl: "https://hubzero.in/studio", mark: "S" },
      createdAt: now, updatedAt: now,
    };
    await applications.insertOne(application);
    const saved = await applications.findOne({ id: applicationId as never });
    if (!saved || saved.clientId !== clientId || saved.redirectUris.length !== 1 || saved.redirectUris[0] !== callback || !saved.enabled) {
      throw new Error("Production Studio application verification failed; stop before migration planning");
    }
    process.stdout.write(JSON.stringify({ database: "hubzero_identity", applicationId, clientId, callback, clientType: saved.clientType, secretReference, enabled: saved.enabled, membershipsCreated: 0, identityUsersCreated: 0, studioMappingsAdded: 0, status: "registered" }) + "\n");
  } finally {
    await Promise.all([identityClient.close(), studioClient.close()]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Production client registration failed"}; no secret values emitted\n`);
  process.exitCode = 1;
});
