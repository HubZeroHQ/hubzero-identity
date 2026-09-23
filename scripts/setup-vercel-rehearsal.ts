import { ObjectId } from "mongodb";
import { parseEnvironment } from "@/lib/env";
import { getIdentityDatabaseConnection } from "@/lib/db/mongodb";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { identityApplicationsCollection } from "@/lib/db/collections";
import { PasswordService } from "@/lib/credentials/password";
import { CredentialService } from "@/lib/credentials/service";
import { ProvisioningService } from "@/lib/identity/provisioning";
import { MongoSecurityEventWriter } from "@/lib/security/events";

const password = process.env.REHEARSAL_TEST_PASSWORD;
if (!password) throw new Error("REHEARSAL_TEST_PASSWORD is required and is never printed");
const email = process.env.REHEARSAL_TEST_EMAIL ?? "vercel-rehearsal@example.invalid";
const idempotencyKey = process.env.REHEARSAL_IDEMPOTENCY_KEY ?? "phase-6b-vercel-rehearsal-user-0001";
const studioCallback = process.env.REHEARSAL_STUDIO_CALLBACK_URL ?? "http://127.0.0.1:4100/studio/oidc/callback";
if (!email.endsWith("@example.invalid")) throw new Error("REHEARSAL_TEST_EMAIL must use the synthetic example.invalid domain");
if (!idempotencyKey.startsWith("phase-6b-vercel-rehearsal-")) throw new Error("REHEARSAL_IDEMPOTENCY_KEY must be explicitly scoped to Phase 6B Vercel rehearsal");
if (studioCallback !== "http://127.0.0.1:4100/studio/oidc/callback") throw new Error("REHEARSAL_STUDIO_CALLBACK_URL is fixed to the isolated Studio callback");
const environment = parseEnvironment(process.env);
if (environment.MONGODB_DATABASE !== "hubzero_identity_rehearsal" || environment.APP_ENV !== "test") {
  throw new Error("This setup command accepts only APP_ENV=test and hubzero_identity_rehearsal");
}

const { client, database } = await getIdentityDatabaseConnection(environment);
try {
  const indexes = await applyIdentityIndexes(database);
  const now = new Date();
  await identityApplicationsCollection(database).updateOne(
    { id: "studio-rehearsal" as never },
    { $set: {
      id: "studio-rehearsal" as never, slug: "studio-rehearsal", displayName: "HubZero Studio Rehearsal",
      description: "Synthetic Phase 6B relying-party rehearsal", clientId: "hubzero-studio-rehearsal",
      clientType: "confidential_web", clientSecretReference: "studio-rehearsal", visibility: "internal",
      redirectUris: [studioCallback], postLogoutRedirectUris: ["http://127.0.0.1:4100"],
      firstParty: true, enabled: true, brand: { homeUrl: "http://127.0.0.1:4100" }, updatedAt: now,
    }, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
    { upsert: true },
  );
  const events = new MongoSecurityEventWriter(database);
  const credentials = new CredentialService(database, client, PasswordService.create(), events);
  const provisioner = new ProvisioningService(database, client, credentials, events);
  const [local, domain] = email.split("@");
  const rehearsalAccounts = [
    { email, name: "Synthetic Vercel Rehearsal User", memberships: ["studio-rehearsal"], suffix: "primary" },
    { email: `${local}.no-membership@${domain}`, name: "Synthetic Rehearsal No Membership", memberships: [], suffix: "no-membership" },
    { email: `${local}.no-mapping@${domain}`, name: "Synthetic Rehearsal No Mapping", memberships: ["studio-rehearsal"], suffix: "no-mapping" },
    { email: `${local}.disabled@${domain}`, name: "Synthetic Rehearsal Disabled", memberships: ["studio-rehearsal"], suffix: "disabled" },
  ];
  const provisionedAccounts: Array<{ kind: string; subject: string }> = [];
  for (const account of rehearsalAccounts) {
    const result = await provisioner.provision({
      name: account.name, email: account.email, password,
      accountType: "internal", mustChangePassword: false, applicationIds: account.memberships,
      idempotencyKey: `${idempotencyKey}:${account.suffix}`, actorSubject: "hz_01J8Y80J3QY33NZ7J7D8FV1J0M" as never,
      reason: "Phase 6B isolated Vercel runtime rehearsal",
    });
    provisionedAccounts.push({ kind: account.suffix, subject: result.subject });
  }
  process.stdout.write(`${JSON.stringify({ database: environment.MONGODB_DATABASE, indexesCreated: indexes.create.length, indexesVerified: indexes.verified.length, application: "studio-rehearsal", syntheticAccounts: provisionedAccounts })}\n`);
} finally { await client.close(); }
