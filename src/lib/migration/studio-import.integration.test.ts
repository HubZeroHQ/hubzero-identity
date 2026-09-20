import bcrypt from "bcrypt";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IdentitySubject } from "@/domain/identity";
import type { ApplicationId } from "@/domain/applications";
import { CredentialService } from "@/lib/credentials/service";
import { PasswordService } from "@/lib/credentials/password";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection, identityUsersCollection } from "@/lib/db/collections";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { StudioLegacyImportConflictError, StudioLegacyImportService } from "./studio-import";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { FixedClock } from "@/lib/time/clock";
import { startMongoReplicaSet, type MongoTestInstance } from "../../../test/integration/mongodb";

const actor = "hz_01J8Y80J3QY33NZ7J7D8FV1J0M" as IdentitySubject;
const sourceId = "65aa00000000000000000001";
const testParameters = { version: 19 as const, memoryCostKiB: 4096, timeCost: 1, parallelism: 1, hashLength: 16 };

describe("Studio bcrypt import rehearsal", () => {
  let mongo: MongoTestInstance;
  let client: MongoClient;
  let database: Db;
  let clock: FixedClock;
  let imports: StudioLegacyImportService;
  let credentials: CredentialService;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet();
    client = mongo.client;
    database = client.db(`hubzero_identity_migration_test_${Date.now()}`);
  });

  beforeEach(async () => {
    await database.dropDatabase();
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
});

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
