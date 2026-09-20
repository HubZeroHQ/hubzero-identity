import bcrypt from "bcrypt";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId, type Collection, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IdentitySubject } from "@/domain/identity";
import type { ApplicationId } from "@/domain/applications";
import { CredentialService } from "@/lib/credentials/service";
import { PasswordService } from "@/lib/credentials/password";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection, identityUsersCollection } from "@/lib/db/collections";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { StudioLegacyImportConflictError, StudioLegacyImportService } from "./studio-import";
import { buildStudioMigrationDryRun } from "./studio-rehearsal";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { FixedClock } from "@/lib/time/clock";
import { startMongoReplicaSet, type MongoTestInstance } from "../../../test/integration/mongodb";

const actor = "hz_01J8Y80J3QY33NZ7J7D8FV1J0M" as IdentitySubject;
const sourceId = "65aa00000000000000000001";
const testParameters = { version: 19 as const, memoryCostKiB: 4096, timeCost: 1, parallelism: 1, hashLength: 16 };
interface RehearsalJournal { sourceStudioUserId: string; subject: string; checkpoint: string }

describe("Studio bcrypt import rehearsal", () => {
  let mongo: MongoTestInstance;
  let client: MongoClient;
  let database: Db;
  let studioDatabase: Db;
  let clock: FixedClock;
  let imports: StudioLegacyImportService;
  let credentials: CredentialService;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet();
    client = mongo.client;
    database = client.db(`hubzero_identity_migration_test_${Date.now()}`);
    studioDatabase = client.db(`hubzero_studio_migration_test_${Date.now()}`);
  });

  beforeEach(async () => {
    await database.dropDatabase();
    await studioDatabase.dropDatabase();
    await applyIdentityIndexes(database);
    clock = new FixedClock(new Date("2026-09-20T10:00:00.000Z"));
    const events = new MongoSecurityEventWriter(database, clock);
    imports = new StudioLegacyImportService(database, client, events, clock);
    credentials = new CredentialService(database, client, PasswordService.createForTesting(testParameters), events, clock);
    await identityApplicationsCollection(database).insertMany([
      application("studio", "hubzero-studio-rehearsal"),
      application("fitness", "hubzero-fitness-rehearsal"),
    ]);
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it("imports bcrypt without plaintext, preserves state, and atomically upgrades after a successful verification", async () => {
    const legacyPassword = "synthetic legacy rehearsal password";
    const bcryptHash = await bcrypt.hash(legacyPassword, 4);
    const first = await imports.import(input(bcryptHash, { disabled: true, mustChangePassword: true }));
    const replay = await imports.import(input(bcryptHash, { disabled: true, mustChangePassword: true }));

    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, subject: first.subject });
    expect(await identityUsersCollection(database).findOne({ subject: first.subject })).toMatchObject({
      status: "suspended",
      emailVerifiedAt: null,
    });
    expect(await identityMembershipsCollection(database).countDocuments({ identitySubject: first.subject })).toBe(2);
    expect(await identityCredentialsCollection(database).findOne({ identitySubject: first.subject })).toMatchObject({
      algorithm: "bcrypt",
      mustChangePassword: true,
      algorithmParameters: { cost: 4, version: "2b" },
    });

    // A source account would be restored only through the approved account
    // lifecycle before sign-in; this isolates the imported-credential upgrade.
    await identityUsersCollection(database).updateOne({ subject: first.subject }, { $set: { status: "active" } });
    await expect(credentials.verifyAndUpgrade(first.subject, legacyPassword)).resolves.toMatchObject({ valid: true, upgraded: true });
    expect(await identityCredentialsCollection(database).findOne({ identitySubject: first.subject })).toMatchObject({ algorithm: "argon2id", mustChangePassword: true });
  });

  it("does not merge a changed source record or a competing canonical email", async () => {
    const hash = await bcrypt.hash("synthetic legacy rehearsal password", 4);
    await imports.import(input(hash));
    await expect(imports.import(input(hash, { name: "Changed source name" }))).rejects.toThrow(StudioLegacyImportConflictError);
    await expect(imports.import(input(hash, { studioUserId: "65aa00000000000000000002" }))).rejects.toThrow(StudioLegacyImportConflictError);
    expect(await identityUsersCollection(database).countDocuments()).toBe(1);
  });

  it("rehearses the five-account production shape without rewriting Studio ownership", async () => {
    const fixture = await productionShapeFixture();
    const passwordHash = await bcrypt.hash("synthetic cost twelve rehearsal password", 12);
    const dryRun = buildStudioMigrationDryRun(
      fixture.accounts.map((account) => ({ ...account, passwordHash })),
      Object.fromEntries(fixture.accounts.map((account) => [account.studioUserId, ["studio"]])),
    );
    expect(dryRun.inventory).toMatchObject({ accountCount: 5, roles: { headAdmin: 1, admin: 4, member: 0 }, credentials: { bcrypt: 5, costs: { "12": 5 } } });
    expect(dryRun.items.every((item) => item.identityAction === "create_subject_at_apply" && item.applicationIds.join() === "studio")).toBe(true);
    await seedStudioFixture(studioDatabase, fixture, passwordHash);

    const first = await migrateFixture(fixture, passwordHash);
    const second = await migrateFixture(fixture, passwordHash);

    expect(first.created).toBe(5);
    expect(second.created).toBe(0);
    expect(await identityUsersCollection(database).countDocuments()).toBe(5);
    expect(await identityCredentialsCollection(database).countDocuments({ algorithm: "bcrypt" })).toBe(5);
    expect(await identityMembershipsCollection(database).countDocuments({ applicationId: "studio" as ApplicationId })).toBe(5);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $regex: /^hz_/ } })).toBe(5);
    expect(await studioDatabase.collection("media").countDocuments({ createdByUserId: new ObjectId(fixture.accounts[0]!.studioUserId) })).toBe(89);
    expect(await studioDatabase.collection("editorialEvents").countDocuments({ actorUserId: new ObjectId(fixture.accounts[0]!.studioUserId) })).toBe(142);
    expect(await studioDatabase.collection("team").countDocuments({ userId: { $exists: true } })).toBe(0);
  });

  it("resumes after Identity import, records checkpoints, and rolls back through the rehearsal journal", async () => {
    const fixture = await productionShapeFixture();
    const passwordHash = await bcrypt.hash("synthetic cost twelve interruption password", 12);
    await seedStudioFixture(studioDatabase, fixture, passwordHash);
    const journal = database.collection<RehearsalJournal>("studio_migration_rehearsal_journal");

    // Account, credential, and membership creation are one required MongoDB
    // transaction. Its first durable interruption point therefore proves that
    // none of those three can be left independently half-created.
    await expect(migrateFixture(fixture, passwordHash, journal, "after_identity_transaction")).rejects.toThrow("simulated interruption");
    expect(await identityUsersCollection(database).countDocuments()).toBe(1);
    expect(await identityCredentialsCollection(database).countDocuments()).toBe(1);
    expect(await identityMembershipsCollection(database).countDocuments()).toBe(1);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(0);
    expect(await journal.countDocuments({ checkpoint: "identity_imported" })).toBe(1);

    await migrateFixture(fixture, passwordHash, journal);
    expect(await identityUsersCollection(database).countDocuments()).toBe(5);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(5);
    expect(await journal.countDocuments({ checkpoint: "studio_mapped" })).toBe(5);

    await rollbackFixture(journal);
    expect(await identityUsersCollection(database).countDocuments()).toBe(0);
    expect(await identityCredentialsCollection(database).countDocuments()).toBe(0);
    expect(await identityMembershipsCollection(database).countDocuments()).toBe(0);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(0);
    expect(await journal.countDocuments()).toBe(0);

    await expect(migrateFixture(fixture, passwordHash, journal, "after_partial_mapping")).rejects.toThrow("simulated interruption");
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(1);
    expect(await journal.countDocuments({ checkpoint: "studio_mapped" })).toBe(1);
    await migrateFixture(fixture, passwordHash, journal);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(5);
    await rollbackFixture(journal);
    expect(await identityUsersCollection(database).countDocuments()).toBe(0);
    expect(await studioDatabase.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(0);
  });

  async function migrateFixture(
    fixture: Awaited<ReturnType<typeof productionShapeFixture>>,
    passwordHash: string,
    journal: Collection<RehearsalJournal> = database.collection<RehearsalJournal>("studio_migration_rehearsal_journal"),
    interruptAt?: "after_identity_transaction" | "after_partial_mapping",
  ) {
    let created = 0;
    for (const account of fixture.accounts) {
      const imported = await imports.import({ ...input(passwordHash, {
        studioUserId: account.studioUserId,
        name: account.name,
        email: account.email,
        disabled: account.disabled,
        mustChangePassword: account.mustChangePassword,
        applicationIds: ["studio"],
        reason: "Phase 6B synthetic production-shaped rehearsal",
      }) });
      if (imported.created) created += 1;
      await journal.updateOne({ sourceStudioUserId: account.studioUserId }, { $set: { sourceStudioUserId: account.studioUserId, subject: imported.subject, checkpoint: "identity_imported" } }, { upsert: true });
      if (interruptAt === "after_identity_transaction") throw new Error("simulated interruption after_identity_transaction");
      const mapped = await studioDatabase.collection("users").findOneAndUpdate(
        { _id: new ObjectId(account.studioUserId), $or: [{ identitySubject: { $exists: false } }, { identitySubject: imported.subject }] },
        { $set: { identitySubject: imported.subject } },
        { returnDocument: "after" },
      );
      if (!mapped) throw new Error("Studio mapping conflict in isolated rehearsal");
      await journal.updateOne({ sourceStudioUserId: account.studioUserId }, { $set: { checkpoint: "studio_mapped" } });
      if (interruptAt === "after_partial_mapping") throw new Error("simulated interruption after_partial_mapping");
    }
    return { created };
  }

  async function rollbackFixture(journal: Collection<RehearsalJournal>) {
    const entries = await journal.find({}).toArray();
    const subjects = entries.map((entry) => entry.subject as IdentitySubject);
    await studioDatabase.collection("users").updateMany({ identitySubject: { $in: subjects } }, { $unset: { identitySubject: "" } });
    await identityMembershipsCollection(database).deleteMany({ identitySubject: { $in: subjects } });
    await identityCredentialsCollection(database).deleteMany({ identitySubject: { $in: subjects } });
    await identityUsersCollection(database).deleteMany({ subject: { $in: subjects } });
    await journal.deleteMany({});
  }
});

async function productionShapeFixture() {
  return JSON.parse(await readFile(resolve(process.cwd(), "test/fixtures/studio-migration-production-shape.json"), "utf8")) as {
    accounts: Array<{ studioUserId: string; name: string; email: string; role: string; disabled: boolean; mustChangePassword: boolean }>;
  };
}

async function seedStudioFixture(database: Db, fixture: Awaited<ReturnType<typeof productionShapeFixture>>, passwordHash: string) {
  await database.collection("users").insertMany(fixture.accounts.map((account) => ({ _id: new ObjectId(account.studioUserId), ...account, passwordHash })));
  const owner = new ObjectId(fixture.accounts[0]!.studioUserId);
  for (const [collection, field, count] of [["work", "createdByUserId", 1], ["builds", "createdByUserId", 1], ["blueprints", "createdByUserId", 20], ["labs", "createdByUserId", 2], ["media", "createdByUserId", 89], ["documentVersions", "createdByUserId", 4], ["editorialEvents", "actorUserId", 142]] as const) {
    await database.collection(collection).insertMany(Array.from({ length: count }, () => ({ _id: new ObjectId(), [field]: owner })));
  }
  await database.collection("team").insertMany(Array.from({ length: 5 }, () => ({ _id: new ObjectId(), name: "Synthetic Team Record" })));
}

function input(passwordHash: string, overrides: Record<string, unknown> = {}) {
  return {
    studioUserId: sourceId,
    name: "Synthetic Studio User",
    email: "synthetic-studio@example.invalid",
    passwordHash,
    disabled: false,
    mustChangePassword: false,
    applicationIds: ["studio", "fitness"],
    actorSubject: actor,
    reason: "Phase 5 isolated migration rehearsal",
    ...overrides,
  };
}

function application(id: "studio" | "fitness", clientId: string) {
  const now = new Date("2026-09-20T10:00:00.000Z");
  return {
    _id: new ObjectId(),
    id: id as ApplicationId,
    slug: id,
    displayName: `HubZero ${id}`,
    description: "isolated rehearsal application",
    clientId,
    clientType: "confidential_web" as const,
    clientSecretReference: `test-${id}`,
    visibility: "internal" as const,
    redirectUris: ["http://127.0.0.1/callback"],
    postLogoutRedirectUris: ["http://127.0.0.1"],
    firstParty: true,
    enabled: true,
    brand: { homeUrl: "http://127.0.0.1" },
    createdAt: now,
    updatedAt: now,
  };
}
