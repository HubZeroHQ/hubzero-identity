import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApplicationId } from "@/domain/applications";
import { applyIdentityIndexes } from "@/lib/db/indexes";
import { startMongoReplicaSet, type MongoTestInstance } from "../../../test/integration/mongodb";
import { StudioMigrationExecutor } from "./studio-executor";

const ids = Array.from({ length: 5 }, (_, index) => `507f1f77bcf86cd7994390${index + 11}`);
const runId = "phase7-executor-integration";

describe("guarded Studio migration executor", () => {
  let mongo: MongoTestInstance;
  let client: MongoClient;
  let source: Db;
  let target: Db;
  let executor: StudioMigrationExecutor;
  let hash: string;

  beforeAll(async () => {
    mongo = await startMongoReplicaSet();
    client = mongo.client;
    source = client.db(`studio_executor_source_${Date.now()}`);
    target = client.db(`studio_executor_target_${Date.now()}`);
    hash = await bcrypt.hash(randomBytes(32).toString("base64url"), 4);
  });
  afterAll(async () => { await mongo?.stop(); });
  beforeEach(async () => {
    await source.dropDatabase();
    await target.dropDatabase();
    await applyIdentityIndexes(target);
    await source.collection("users").createIndex({ identitySubject: 1 }, { name: "uniq_identity_subject", unique: true, sparse: true });
    await target.collection("identity_applications").insertOne({ id: "studio", enabled: true });
    await source.collection("users").insertMany(ids.map((id, index) => ({
      _id: new ObjectId(id), name: `Synthetic ${index}`, email: `synthetic-${index}@example.invalid`,
      role: index === 0 ? "headAdmin" : "admin", disabled: false, mustChangePassword: false, passwordHash: hash,
    })));
    await source.collection("media").insertOne({ createdByUserId: new ObjectId(ids[0]), marker: "preserve" });
    await source.collection("team").insertOne({ name: "Synthetic Team", marker: "preserve" });
    executor = new StudioMigrationExecutor({ source, target, targetClient: client,
      applicationId: "studio" as ApplicationId, runId, expectedAccountCount: 5 });
  });

  it("plans, recovers after a transaction interruption, reconciles, and reruns without writes or reference changes", async () => {
    const mediaBefore = await source.collection("media").find({}).toArray();
    const teamBefore = await source.collection("team").find({}).toArray();
    const plan = await executor.plan();
    expect(plan.items.every((item) => item.action === "create")).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(hash);
    await expect(executor.apply(false, "identity_imported")).rejects.toThrow("Rehearsal interruption");
    expect(await executor.status()).toMatchObject({ identityImported: 1, studioMapped: 0 });
    expect(await target.collection("identity_users").countDocuments()).toBe(1);
    expect(await target.collection("identity_credentials").countDocuments()).toBe(1);
    expect(await target.collection("identity_memberships").countDocuments()).toBe(1);
    expect(await executor.apply(true)).toMatchObject({ created: 4, mapped: 5 });
    expect(await executor.reconcile()).toEqual({ accounts: 5, identities: 5, credentials: 5, memberships: 5, mappings: 5, journaled: 5 });
    const eventsBefore = await target.collection("identity_security_events").countDocuments();
    expect(await executor.apply()).toMatchObject({ created: 0, mapped: 0 });
    expect(await target.collection("identity_security_events").countDocuments()).toBe(eventsBefore);
    expect(await target.collection("identity_users").countDocuments()).toBe(5);
    expect(await target.collection("identity_credentials").countDocuments()).toBe(5);
    expect(await target.collection("identity_memberships").countDocuments()).toBe(5);
    expect(await target.collection("studio_migration_journal").countDocuments({ passwordHash: { $exists: true } })).toBe(0);
    expect(await source.collection("users").countDocuments({ identitySubject: { $exists: true } })).toBe(5);
    expect(await source.collection("media").find({}).toArray()).toEqual(mediaBefore);
    expect(await source.collection("team").find({}).toArray()).toEqual(teamBefore);
  });

  it("rejects collisions, unsupported credentials, and pre-existing mapping conflicts before writes", async () => {
    await source.collection("users").updateOne({ _id: new ObjectId(ids[1]) }, { $set: { email: "SYNTHETIC-0@example.invalid" } });
    await expect(executor.plan()).rejects.toThrow("collision");
    await source.collection("users").updateOne({ _id: new ObjectId(ids[1]) }, { $set: { email: "synthetic-1@example.invalid", passwordHash: "unsupported" } });
    await expect(executor.plan()).rejects.toThrow("unsupported credential");
    await source.collection("users").updateOne({ _id: new ObjectId(ids[1]) }, { $set: { passwordHash: hash, identitySubject: "hz_01J8Y80J3QY33NZ7J7D8FV1J0M" } });
    await expect(executor.plan()).rejects.toThrow("Unexpected existing Studio identitySubject");
    expect(await target.collection("identity_users").countDocuments()).toBe(0);
  });

  it("resumes a partial Studio mapping without replacing the existing ObjectId or duplicating checkpoints", async () => {
    await expect(executor.apply(false, "studio_mapped")).rejects.toThrow("Rehearsal interruption");
    expect(await executor.status()).toMatchObject({ identityImported: 1, studioMapped: 1, observedMappings: 1 });
    const first = await source.collection("users").findOne({ _id: new ObjectId(ids[0]) });
    expect(await executor.apply(true)).toMatchObject({ created: 4, mapped: 4 });
    expect(await executor.reconcile()).toMatchObject({ accounts: 5, mappings: 5, journaled: 5 });
    const after = await source.collection("users").findOne({ _id: new ObjectId(ids[0]) });
    expect(after?._id).toEqual(first?._id);
    expect(after?.identitySubject).toBe(first?.identitySubject);
    expect(await target.collection("studio_migration_journal").countDocuments({ sourceStudioUserId: ids[0] })).toBe(3);
  });

  it("rejects another run ID after a durable checkpoint", async () => {
    await expect(executor.apply(false, "identity_imported")).rejects.toThrow("Rehearsal interruption");
    const other = new StudioMigrationExecutor({ source, target, targetClient: client,
      applicationId: "studio" as ApplicationId, runId: "different-run-id", expectedAccountCount: 5 });
    await expect(other.plan()).rejects.toThrow("Conflicting migration journal");
  });
});
