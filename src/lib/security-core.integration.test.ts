import bcrypt from "bcrypt";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IdentitySubject } from "@/domain/identity";
import type { ApplicationId } from "@/domain/applications";
import { AccountSecurityService } from "@/lib/identity/account-security";
import { CredentialService } from "@/lib/credentials/service";
import { PasswordService, parseBcryptHash } from "@/lib/credentials/password";
import { applyIdentityIndexes, IndexMigrationConflictError } from "@/lib/db/indexes";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection, identityRateLimitsCollection, identitySecurityEventsCollection, identitySessionsCollection, identityUsersCollection } from "@/lib/db/collections";
import { ProvisioningConflictError, ProvisioningService } from "@/lib/identity/provisioning";
import { MongoFixedWindowRateLimiter, RateLimitStorageError } from "@/lib/rate-limit/rate-limiter";
import { MongoSecurityEventWriter, type SecurityEventSink } from "@/lib/security/events";
import { SessionService } from "@/lib/sessions/service";
import { FixedClock } from "@/lib/time/clock";
import { startMongoReplicaSet, type MongoTestInstance } from "../../test/integration/mongodb";

const actorSubject = "hz_01J8Y80J3QY33NZ7J7D8FV1J0M" as IdentitySubject;
const password = "correct horse battery staple";
const testPasswordParameters = { version: 19 as const, memoryCostKiB: 4096, timeCost: 1, parallelism: 1, hashLength: 16 };

describe("identity security core with MongoDB", () => {
  let mongo: MongoTestInstance;
  let client: MongoClient;
  let database: Db;
  let clock: FixedClock;
  let events: MongoSecurityEventWriter;
  let passwords: PasswordService;
  let credentials: CredentialService;
  let provisioning: ProvisioningService;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet();
    client = mongo.client;
    database = client.db(`hubzero_identity_test_${Date.now()}`);
  });

  beforeEach(async () => {
    await database.dropDatabase();
    await applyIdentityIndexes(database);
    clock = new FixedClock(new Date("2026-09-19T10:00:00.000Z"));
    events = new MongoSecurityEventWriter(database, clock);
    passwords = PasswordService.createForTesting(testPasswordParameters);
    credentials = new CredentialService(database, client, passwords, events, clock);
    provisioning = new ProvisioningService(database, client, credentials, events, clock);
  });

  afterAll(async () => {
    if (mongo) await mongo.stop();
  });

  it("applies the index manifest idempotently and rejects incompatible definitions", async () => {
    const second = await applyIdentityIndexes(database);
    expect(second.create).toHaveLength(0);
    expect(second.verified.length).toBeGreaterThan(0);

    await database.dropDatabase();
    await database.collection("identity_users").createIndex({ subject: 1 }, { name: "uniq_subject", unique: false });
    await expect(applyIdentityIndexes(database)).rejects.toThrow(IndexMigrationConflictError);
    expect(await database.collection("identity_credentials").listIndexes().toArray().catch(() => [])).toHaveLength(0);
  });

  it("linearizes concurrent duplicate provisioning into one identity and one immutable subject", async () => {
    const input = provisionInput("Person@Example.com", "request-key-00000001");
    const results = await Promise.all([provisioning.provision(input), provisioning.provision(input)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.subject)).size).toBe(1);
    expect(await identityUsersCollection(database).countDocuments()).toBe(1);
    expect(await identityCredentialsCollection(database).countDocuments()).toBe(1);
  });

  it("enforces normalized email uniqueness and rejects incompatible idempotency replay", async () => {
    await provisioning.provision(provisionInput("Person@Example.com", "request-key-00000001"));
    await expect(provisioning.provision(provisionInput(" person@example.COM ", "request-key-00000002"))).rejects.toThrow(ProvisioningConflictError);
    await expect(provisioning.provision({ ...provisionInput("Person@Example.com", "request-key-00000001"), name: "Different Person" })).rejects.toThrow(ProvisioningConflictError);
    expect(await identityUsersCollection(database).countDocuments()).toBe(1);
  });

  it("creates only explicit application membership without product role authority", async () => {
    const applicationId = "studio" as ApplicationId;
    const now = clock.now();
    await identityApplicationsCollection(database).insertOne({
      _id: new ObjectId(), id: applicationId, slug: "studio", displayName: "HubZero Studio", description: "CMS",
      clientId: "studio-test", clientType: "confidential_web", visibility: "internal", redirectUris: ["http://localhost/callback"],
      postLogoutRedirectUris: ["http://localhost"], firstParty: true, enabled: true, brand: { homeUrl: "http://localhost" }, createdAt: now, updatedAt: now,
    });
    const account = await provisioning.provision({ ...provisionInput("member@example.com", "request-key-00000020"), applicationIds: [applicationId] });
    const membership = await identityMembershipsCollection(database).findOne({ identitySubject: account.subject, applicationId });
    expect(membership?.status).toBe("active");
    expect(membership).not.toHaveProperty("role");
  });

  it("does not provision membership for a missing or disabled application", async () => {
    const disabledId = "fitness" as ApplicationId;
    const now = clock.now();
    await identityApplicationsCollection(database).insertOne({
      _id: new ObjectId(), id: disabledId, slug: "fitness", displayName: "HubZero Fitness", description: "Fitness",
      clientId: "fitness-test", clientType: "confidential_web", visibility: "private", redirectUris: ["http://localhost/callback"],
      postLogoutRedirectUris: ["http://localhost"], firstParty: true, enabled: false, brand: { homeUrl: "http://localhost" }, createdAt: now, updatedAt: now,
    });
    await expect(provisioning.provision({ ...provisionInput("denied@example.com", "request-key-00000021"), applicationIds: [disabledId] })).rejects.toThrow(ProvisioningConflictError);
    expect(await identityUsersCollection(database).countDocuments()).toBe(0);
  });

  it("aborts account, credential, and audit writes when required audit persistence fails", async () => {
    const failingEvents = { append: async () => { throw new Error("audit unavailable"); } } as SecurityEventSink;
    const failingCredentials = new CredentialService(database, client, passwords, failingEvents, clock);
    const failingProvisioning = new ProvisioningService(database, client, failingCredentials, failingEvents, clock);
    await expect(failingProvisioning.provision(provisionInput("audit@example.com", "request-key-00000003"))).rejects.toThrow("audit unavailable");
    expect(await identityUsersCollection(database).countDocuments()).toBe(0);
    expect(await identityCredentialsCollection(database).countDocuments()).toBe(0);
    expect(await identitySecurityEventsCollection(database).countDocuments()).toBe(0);
  });

  it("upgrades two concurrent bcrypt verifications once without corruption or regression", async () => {
    const account = await provisioning.provision(provisionInput("legacy@example.com", "request-key-00000004"));
    const bcryptHash = await bcrypt.hash(password, 4);
    await identityCredentialsCollection(database).updateOne({ identitySubject: account.subject }, { $set: {
      passwordHash: bcryptHash,
      algorithm: "bcrypt",
      algorithmParameters: parseBcryptHash(bcryptHash),
    } });

    const results = await Promise.all([
      credentials.verifyAndUpgrade(account.subject, password),
      credentials.verifyAndUpgrade(account.subject, password),
    ]);
    expect(results.every((result) => result.valid)).toBe(true);
    expect(results.filter((result) => result.upgraded)).toHaveLength(1);
    const finalCredential = await identityCredentialsCollection(database).findOne({ identitySubject: account.subject });
    expect(finalCredential?.algorithm).toBe("argon2id");
    await expect(passwords.verify(finalCredential!, password)).resolves.toMatchObject({ valid: true });
    expect(await identitySecurityEventsCollection(database).countDocuments({ type: "password.legacy_migrated" })).toBe(1);
  });

  it("rotates once under concurrent validation and accepts the previous secret only during grace", async () => {
    const account = await provision("rotation@example.com", "request-key-00000005");
    const sessions = new SessionService(database, client, Buffer.alloc(32, 3), events, clock);
    const created = await sessions.create({ identitySubject: account.subject });
    clock.advance(24 * 60 * 60 * 1000 + 1);
    const results = await Promise.all([sessions.validate(created.token), sessions.validate(created.token)]);
    expect(results.every(Boolean)).toBe(true);
    const rotated = results.find((result) => result?.rotatedToken)?.rotatedToken;
    expect(rotated).toBeTruthy();
    expect(await sessions.validate(created.token)).not.toBeNull();
    clock.advance(2 * 60 * 1000 + 1);
    expect(await sessions.validate(created.token)).toBeNull();
    expect(await sessions.validate(rotated!)).not.toBeNull();
  });

  it("makes individual revocation durable after the revocation linearization point", async () => {
    const account = await provision("revoke@example.com", "request-key-00000006");
    const sessions = new SessionService(database, client, Buffer.alloc(32, 4), events, clock);
    const created = await sessions.create({ identitySubject: account.subject });
    expect(await sessions.validate(created.token)).not.toBeNull();
    await sessions.revoke(created.sessionId, actorSubject, "operator_request");
    expect(await sessions.validate(created.token)).toBeNull();
  });

  it("invalidates every prior session through the account session version", async () => {
    const account = await provision("global@example.com", "request-key-00000007");
    const sessions = new SessionService(database, client, Buffer.alloc(32, 5), events, clock);
    const first = await sessions.create({ identitySubject: account.subject });
    const second = await sessions.create({ identitySubject: account.subject });
    expect(await sessions.revokeAll(account.subject, actorSubject, "security_change")).toBe(2);
    expect(await sessions.validate(first.token)).toBeNull();
    expect(await sessions.validate(second.token)).toBeNull();
  });

  it("suspends centrally and restoration does not resurrect old sessions", async () => {
    const account = await provision("suspend@example.com", "request-key-00000008");
    const sessions = new SessionService(database, client, Buffer.alloc(32, 6), events, clock);
    const created = await sessions.create({ identitySubject: account.subject });
    const accountSecurity = new AccountSecurityService(database, client, events, clock);
    await accountSecurity.suspend(account.subject, actorSubject, "incident_response");
    expect(await sessions.validate(created.token)).toBeNull();
    await expect(sessions.create({ identitySubject: account.subject })).rejects.toThrow("Active account not found");
    await accountSecurity.restore(account.subject, actorSubject, "review_complete");
    expect(await sessions.validate(created.token)).toBeNull();
    expect(await sessions.create({ identitySubject: account.subject })).toBeTruthy();
  });

  it("rejects expired, idle-expired, version-mismatched, and invalid session material", async () => {
    const account = await provision("expiry@example.com", "request-key-00000009");
    const sessions = new SessionService(database, client, Buffer.alloc(32, 7), events, clock);
    const absolute = await sessions.create({ identitySubject: account.subject });
    await identitySessionsCollection(database).updateOne({ id: absolute.sessionId }, { $set: { absoluteExpiresAt: new Date(clock.now().getTime() - 1) } });
    expect(await sessions.validate(absolute.token)).toBeNull();
    const idle = await sessions.create({ identitySubject: account.subject });
    await identitySessionsCollection(database).updateOne({ id: idle.sessionId }, { $set: { idleExpiresAt: new Date(clock.now().getTime() - 1) } });
    expect(await sessions.validate(idle.token)).toBeNull();
    const stale = await sessions.create({ identitySubject: account.subject });
    await identityUsersCollection(database).updateOne({ subject: account.subject }, { $inc: { sessionVersion: 1 } });
    expect(await sessions.validate(stale.token)).toBeNull();
    expect(await sessions.validate("ses_01J8Y80J3QY33NZ7J7D8FV1J0M." + "x".repeat(43))).toBeNull();
  });

  it("enforces one atomic allowance under concurrent rate-limit attempts", async () => {
    const limiter = new MongoFixedWindowRateLimiter(database, Buffer.alloc(32, 8), events, clock);
    const decisions = await Promise.all(Array.from({ length: 20 }, () => limiter.consume({ namespace: "login.account", key: "person@example.com", limit: 5, windowSeconds: 60 })));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(15);
    const bucket = await identityRateLimitsCollection(database).findOne({});
    expect(bucket?.count).toBe(6);
    expect(bucket?._id).not.toContain("person@example.com");
  });

  it("surfaces rate-limit storage failure rather than pretending an allowance", async () => {
    await database.dropDatabase();
    const limiter = new MongoFixedWindowRateLimiter(database, Buffer.alloc(32, 9), { append: async () => { throw new Error("audit unavailable"); } } as SecurityEventSink, clock);
    const first = await limiter.consume({ namespace: "login.ip", key: "192.0.2.0/24", limit: 1, windowSeconds: 60 });
    expect(first.allowed).toBe(true);
    await expect(limiter.consume({ namespace: "login.ip", key: "192.0.2.0/24", limit: 1, windowSeconds: 60 })).rejects.toThrow(RateLimitStorageError);
  });

  async function provision(email: string, idempotencyKey: string) {
    return provisioning.provision(provisionInput(email, idempotencyKey));
  }
});

function provisionInput(email: string, idempotencyKey: string) {
  return {
    name: "Test Person",
    email,
    password,
    accountType: "internal" as const,
    mustChangePassword: false,
    applicationIds: [],
    idempotencyKey,
    actorSubject,
    reason: "integration test",
  };
}
