import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import bcrypt from "bcrypt";
import { MongoClient, ObjectId } from "mongodb";
import { parseBcryptHash } from "../src/lib/credentials/password";
import { applyIdentityIndexes } from "../src/lib/db/indexes";

const databaseName = "hubzero_studio_rehearsal";
async function main(): Promise<void> {
const uri = process.env.STUDIO_REHEARSAL_MONGODB_URI;
const identityUri = process.env.REHEARSAL_MONGODB_URI;
if (!process.argv.includes("--confirm-rehearsal") || !uri || !identityUri) throw new Error("Both dedicated rehearsal URIs and --confirm-rehearsal are required");
let target: URL;
try { target = new URL(uri); } catch { throw new Error("Invalid rehearsal URI"); }
if (decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== databaseName) throw new Error("Wrong rehearsal database target");
let identityTarget: URL;
try { identityTarget = new URL(identityUri); } catch { throw new Error("Invalid Identity rehearsal URI"); }
if (decodeURIComponent(identityTarget.pathname.replace(/^\/+/, "")) !== "hubzero_identity_rehearsal") throw new Error("Wrong Identity rehearsal database target");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
const identityClient = new MongoClient(identityUri, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  await identityClient.connect();
  const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
  const roles: unknown[] = status.authInfo?.authenticatedUserRoles ?? [];
  if (roles.length !== 1 || (roles[0] as { role?: unknown })?.role !== "readWrite" || (roles[0] as { db?: unknown })?.db !== databaseName) {
    throw new Error("Rehearsal fixture requires exactly readWrite@hubzero_studio_rehearsal");
  }
  const identityStatus = await identityClient.db("admin").command({ connectionStatus: 1, showPrivileges: false });
  const identityRoles: unknown[] = identityStatus.authInfo?.authenticatedUserRoles ?? [];
  if (identityRoles.length !== 1 || (identityRoles[0] as { role?: unknown })?.role !== "readWrite"
    || (identityRoles[0] as { db?: unknown })?.db !== "hubzero_identity_rehearsal") {
    throw new Error("Identity fixture requires exactly readWrite@hubzero_identity_rehearsal");
  }
  const indexPlan = await applyIdentityIndexes(identityClient.db("hubzero_identity_rehearsal"));
  const db = client.db(databaseName);
  const fixture = JSON.parse(await readFile(resolve(process.cwd(), "test/fixtures/studio-migration-production-shape.json"), "utf8")) as {
    accounts: Array<{ studioUserId: string; name: string; email: string; role: string; disabled: boolean; mustChangePassword: boolean }>;
    referenceShape: Record<string, unknown>;
  };
  if (fixture.accounts.length !== 5) throw new Error("Synthetic fixture count must be five");
  const users = db.collection("users");
  let created = 0;
  for (const account of fixture.accounts) {
    const id = new ObjectId(account.studioUserId);
    const existing = await users.findOne({ _id: id });
    if (existing) {
      if (existing.migrationExecutorFixture !== true || existing.email !== account.email || existing.role !== account.role
        || typeof existing.passwordHash !== "string") throw new Error("Synthetic fixture ObjectId conflict");
      parseBcryptHash(existing.passwordHash);
      continue;
    }
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    await users.insertOne({ _id: id, name: account.name, email: account.email, role: account.role,
      disabled: account.disabled, mustChangePassword: account.mustChangePassword, passwordHash,
      authVersion: 1, migrationExecutorFixture: true, createdAt: new Date(), updatedAt: new Date() });
    created += 1;
  }
  const owner = new ObjectId(fixture.accounts[0]!.studioUserId);
  for (const [path, count] of Object.entries(fixture.referenceShape)) {
    if (path === "team") continue;
    const [collection, field] = path.split(".");
    if (!collection || !field || typeof count !== "number") throw new Error("Invalid synthetic reference fixture");
    for (let index = 0; index < count; index += 1) {
      const marker = `phase7-migration-executor:${path}:${index}`;
      const id = new ObjectId(createHash("sha256").update(marker).digest("hex").slice(0, 24));
      await db.collection(collection).updateOne({ _id: id }, { $setOnInsert: { _id: id, [field]: owner, migrationExecutorFixture: true } }, { upsert: true });
    }
  }
  for (let index = 0; index < 5; index += 1) {
    const id = new ObjectId(createHash("sha256").update(`phase7-migration-executor:team:${index}`).digest("hex").slice(0, 24));
    await db.collection("team").updateOne({ _id: id }, { $setOnInsert: { _id: id, name: "Synthetic Team Record", migrationExecutorFixture: true } }, { upsert: true });
  }
  process.stdout.write(`${JSON.stringify({ database: databaseName, role: "readWrite@hubzero_studio_rehearsal", identityDatabase: "hubzero_identity_rehearsal", identityRole: "readWrite@hubzero_identity_rehearsal", indexesCreated: indexPlan.create.length, fixtureAccounts: 5, accountsCreated: created, references: "idempotently seeded", productionFallback: false })}\n`);
} finally {
  await client.close();
  await identityClient.close();
}
}

main().catch(() => {
  // Driver exceptions can contain URI details; emit no raw error here.
  process.stderr.write("Isolated rehearsal fixture preflight or initialization failed\n");
  process.exitCode = 1;
});
