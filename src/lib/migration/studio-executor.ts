import { ObjectId, type Db, type MongoClient } from "mongodb";
import type { ApplicationId } from "@/domain/applications";
import type { IdentitySubject } from "@/domain/identity";
import { identityCredentialsCollection, identityMembershipsCollection, identityUsersCollection } from "@/lib/db/collections";
import { normalizeEmail } from "@/lib/identity/email";
import { parseBcryptHash } from "@/lib/credentials/password";
import { MongoSecurityEventWriter } from "@/lib/security/events";
import { studioImportFingerprint, studioImportIdentityKey, StudioLegacyImportService } from "./studio-import";

type Step = "identity_imported" | "studio_mapped" | "reconciled";
interface JournalEntry {
  _id: ObjectId;
  runId: string;
  sourceStudioUserId: string;
  subject: IdentitySubject;
  step: Step;
  occurredAt: Date;
}
interface StudioSource {
  _id: ObjectId;
  name?: unknown;
  email?: unknown;
  role?: unknown;
  disabled?: unknown;
  mustChangePassword?: unknown;
  passwordHash?: unknown;
  identitySubject?: unknown;
}
export interface MigrationExecutorOptions {
  source: Db;
  target: Db;
  targetClient: MongoClient;
  applicationId: ApplicationId;
  runId: string;
  expectedAccountCount: 5;
  /** Only the isolated rehearsal may select the five synthetic fixture IDs. */
  rehearsalSourceIds?: readonly string[];
}
interface CheckedSource {
  id: string;
  name: string;
  email: string;
  normalizedEmail: string;
  role: "headAdmin" | "admin";
  disabled: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
  identitySubject?: IdentitySubject;
  fingerprint: string;
  existingSubject?: IdentitySubject;
}

export class StudioMigrationGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioMigrationGateError";
  }
}

/** One executor for the isolated rehearsal and eventual production operation. */
export class StudioMigrationExecutor {
  private journal;

  constructor(private options: MigrationExecutorOptions) {
    this.journal = options.target.collection<JournalEntry>("studio_migration_journal");
  }

  async plan(): Promise<{ accountCount: number; roles: Record<string, number>; items: Array<{ studioUserId: string; role: string; action: "create" | "resume" | "complete"; subject: string | null }> }> {
    const accounts = await this.checkedSources();
    return {
      accountCount: accounts.length,
      roles: accounts.reduce<Record<string, number>>((roles, account) => ({ ...roles, [account.role]: (roles[account.role] ?? 0) + 1 }), {}),
      items: await Promise.all(accounts.map(async (account) => {
        const steps = await this.steps(account.id);
        return { studioUserId: account.id, role: account.role,
          action: steps.includes("reconciled") ? "complete" : account.existingSubject ? "resume" : "create",
          subject: account.existingSubject ?? null };
      })),
    };
  }

  async status(): Promise<{ expectedAccountCount: 5; sourceAccountCount: number; observedIdentityImports: number; observedMappings: number; journalEntries: number; identityImported: number; studioMapped: number; reconciled: number }> {
    const records = await this.journal.find({ runId: this.options.runId }, { projection: { step: 1 } }).toArray();
    const filter = this.options.rehearsalSourceIds
      ? { _id: { $in: this.options.rehearsalSourceIds.map((id) => new ObjectId(id)) } }
      : {};
    const sources = await this.options.source.collection<StudioSource>("users").find(filter, { projection: { _id: 1, identitySubject: 1 } }).toArray();
    const imported = await Promise.all(sources.map((source) => identityUsersCollection(this.options.target)
      .countDocuments({ "provisioning.idempotencyKeyHash": studioImportIdentityKey(source._id.toHexString()) })));
    return { expectedAccountCount: 5, sourceAccountCount: sources.length,
      observedIdentityImports: imported.reduce((count, value) => count + value, 0),
      observedMappings: sources.filter((source) => typeof source.identitySubject === "string").length,
      journalEntries: records.length,
      identityImported: records.filter((record) => record.step === "identity_imported").length,
      studioMapped: records.filter((record) => record.step === "studio_mapped").length,
      reconciled: records.filter((record) => record.step === "reconciled").length };
  }

  async apply(resume = false, interruptAfter?: "identity_imported" | "studio_mapped"): Promise<{ created: number; mapped: number; status: Awaited<ReturnType<StudioMigrationExecutor["status"]>> }> {
    const accounts = await this.checkedSources(); // No production write before every independent precondition passes.
    if (!resume) {
      const partial = await this.journal.findOne({ runId: this.options.runId, step: { $ne: "reconciled" } });
      if (partial) {
        const completed = await this.journal.countDocuments({ runId: this.options.runId, step: "reconciled" });
        if (completed !== accounts.length) throw new StudioMigrationGateError("Partial migration exists; use resume after reviewing status");
      }
    }
    const importer = new StudioLegacyImportService(this.options.target, this.options.targetClient, new MongoSecurityEventWriter(this.options.target));
    let created = 0;
    let mapped = 0;
    for (const account of accounts) {
      // Detect a password/account change after planning instead of importing a stale in-memory record.
      const current = await this.options.source.collection<StudioSource>("users").findOne({ _id: new ObjectId(account.id) });
      if (!current || this.sourceFingerprint(current) !== account.fingerprint) throw new StudioMigrationGateError("Studio source changed during migration; stop and re-plan");
      if (current.identitySubject !== account.identitySubject) throw new StudioMigrationGateError("Studio mapping changed during migration; stop and re-plan");
      const imported = account.existingSubject ? { created: false, subject: account.existingSubject } : await importer.import({
        studioUserId: account.id, name: account.name, email: account.email, passwordHash: account.passwordHash,
        disabled: account.disabled, mustChangePassword: account.mustChangePassword,
        applicationIds: [this.options.applicationId], reason: "Approved Phase 7 Studio identity migration",
      });
      if (account.existingSubject && imported.subject !== account.existingSubject) throw new StudioMigrationGateError("Identity subject changed during migration");
      if (imported.created) created += 1;
      await this.record(account.id, imported.subject, "identity_imported");
      if (interruptAfter === "identity_imported") throw new StudioMigrationGateError("Rehearsal interruption after Identity transaction");
      if (!account.identitySubject) {
        const result = await this.options.source.collection<StudioSource>("users").updateOne(
          { _id: new ObjectId(account.id), identitySubject: { $exists: false } },
          { $set: { identitySubject: imported.subject, updatedAt: new Date() } },
        );
        if (result.matchedCount !== 1) throw new StudioMigrationGateError("Studio mapping conflict; stop and reconcile");
        mapped += 1;
      }
      await this.record(account.id, imported.subject, "studio_mapped");
      if (interruptAfter === "studio_mapped") throw new StudioMigrationGateError("Rehearsal interruption after Studio mapping");
    }
    return { created, mapped, status: await this.status() };
  }

  async reconcile(): Promise<{ accounts: number; identities: number; credentials: number; memberships: number; mappings: number; journaled: number }> {
    const accounts = await this.checkedSources();
    let identities = 0;
    let credentials = 0;
    let memberships = 0;
    let mappings = 0;
    for (const account of accounts) {
      const subject = account.existingSubject;
      if (!subject) throw new StudioMigrationGateError("Unmapped Studio account; reconciliation failed");
      const user = await identityUsersCollection(this.options.target).findOne({ subject });
      if (!user || user.provisioning.idempotencyKeyHash !== studioImportIdentityKey(account.id)
        || user.provisioning.inputFingerprint !== account.fingerprint
        || user.normalizedEmail !== account.normalizedEmail
        || user.status !== (account.disabled ? "suspended" : "active")) {
        throw new StudioMigrationGateError("Identity user reconciliation failed");
      }
      identities += 1;
      const credential = await identityCredentialsCollection(this.options.target).findOne({ identitySubject: subject, type: "password" });
      if (!credential || credential.algorithm !== "bcrypt" || credential.passwordHash !== account.passwordHash
        || credential.mustChangePassword !== account.mustChangePassword) throw new StudioMigrationGateError("Identity credential reconciliation failed");
      credentials += 1;
      const member = await identityMembershipsCollection(this.options.target).findOne({ identitySubject: subject, applicationId: this.options.applicationId, status: "active" });
      if (!member) throw new StudioMigrationGateError("Studio membership reconciliation failed");
      memberships += 1;
      const studio = await this.options.source.collection<StudioSource>("users").findOne({ _id: new ObjectId(account.id), identitySubject: subject });
      if (!studio) throw new StudioMigrationGateError("Studio ObjectId mapping reconciliation failed");
      mappings += 1;
      const steps = await this.steps(account.id);
      if (!steps.includes("identity_imported") || !steps.includes("studio_mapped")) throw new StudioMigrationGateError("Migration journal is incomplete");
    }
    // Record only after the entire batch reconciles, so a failed batch does not advertise partial acceptance.
    for (const account of accounts) await this.record(account.id, account.existingSubject!, "reconciled");
    return { accounts: accounts.length, identities, credentials, memberships, mappings, journaled: await this.journal.countDocuments({ runId: this.options.runId, step: "reconciled" }) };
  }

  private async checkedSources(): Promise<CheckedSource[]> {
    const { source, target, expectedAccountCount, applicationId, rehearsalSourceIds } = this.options;
    const filter = rehearsalSourceIds ? { _id: { $in: rehearsalSourceIds.map((id) => new ObjectId(id)) } } : {};
    const raw = await source.collection<StudioSource>("users").find(filter).sort({ _id: 1 }).toArray();
    if (raw.length !== expectedAccountCount) throw new StudioMigrationGateError(`Expected ${expectedAccountCount} Studio accounts; observed ${raw.length}`);
    const application = await target.collection("identity_applications").findOne({ id: applicationId, enabled: true });
    if (!application) throw new StudioMigrationGateError("Approved Studio application is missing or disabled");
    await this.assertIndexes();
    const emails = new Set<string>();
    const accounts: CheckedSource[] = [];
    for (const sourceUser of raw) {
      if (!(sourceUser._id instanceof ObjectId) || typeof sourceUser.name !== "string" || !sourceUser.name.trim() || sourceUser.name.trim().length > 120
        || typeof sourceUser.email !== "string" || sourceUser.email.length > 320 || typeof sourceUser.passwordHash !== "string"
        || !["headAdmin", "admin"].includes(String(sourceUser.role))
        || (sourceUser.disabled !== undefined && typeof sourceUser.disabled !== "boolean")
        || (sourceUser.mustChangePassword !== undefined && typeof sourceUser.mustChangePassword !== "boolean")) {
        throw new StudioMigrationGateError("Studio account has unsupported source shape or missing credential");
      }
      let normalizedEmail: string;
      try {
        normalizedEmail = normalizeEmail(sourceUser.email).normalizedEmail;
        parseBcryptHash(sourceUser.passwordHash);
      } catch {
        throw new StudioMigrationGateError("Studio account has invalid email or unsupported credential");
      }
      if (emails.has(normalizedEmail)) throw new StudioMigrationGateError("Canonical email collision in Studio source");
      emails.add(normalizedEmail);
      const id = sourceUser._id.toHexString();
      const fingerprint = this.sourceFingerprint(sourceUser);
      const sourceKey = studioImportIdentityKey(id);
      const existing = await identityUsersCollection(target).findOne({ "provisioning.idempotencyKeyHash": sourceKey });
      const emailOwner = await identityUsersCollection(target).findOne({ normalizedEmail });
      if (existing && (existing.provisioning.inputFingerprint !== fingerprint || emailOwner?.subject !== existing.subject)) {
        throw new StudioMigrationGateError("Conflicting existing Identity source or email");
      }
      if (existing) {
        const credential = await identityCredentialsCollection(target).findOne({ identitySubject: existing.subject, type: "password" });
        const memberships = await identityMembershipsCollection(target).find({ identitySubject: existing.subject, status: "active" }).toArray();
        if (!credential || credential.algorithm !== "bcrypt" || credential.passwordHash !== sourceUser.passwordHash
          || credential.mustChangePassword !== (sourceUser.mustChangePassword === true)
          || existing.status !== (sourceUser.disabled === true ? "suspended" : "active")
          || memberships.length !== 1 || memberships[0]?.applicationId !== applicationId) {
          throw new StudioMigrationGateError("Existing Identity credential, state, or membership conflicts with Studio source");
        }
      }
      if (!existing && emailOwner) throw new StudioMigrationGateError("Canonical email already belongs to another Identity user");
      if (sourceUser.identitySubject !== undefined && (!existing || sourceUser.identitySubject !== existing.subject)) {
        throw new StudioMigrationGateError("Unexpected existing Studio identitySubject mapping");
      }
      if (existing && sourceUser.identitySubject && sourceUser.identitySubject !== existing.subject) throw new StudioMigrationGateError("Conflicting Studio mapping");
      const events = await this.journal.find({ sourceStudioUserId: id }).toArray();
      if (events.some((event) => event.runId !== this.options.runId || event.subject !== existing?.subject)) {
        throw new StudioMigrationGateError("Conflicting migration journal run or subject");
      }
      if (events.some((event) => event.step === "studio_mapped" || event.step === "reconciled")
        && sourceUser.identitySubject !== existing?.subject) {
        throw new StudioMigrationGateError("Journaled Studio mapping is missing or changed");
      }
      accounts.push({ id, name: sourceUser.name, email: sourceUser.email, normalizedEmail,
        role: sourceUser.role as "headAdmin" | "admin", disabled: sourceUser.disabled === true,
        mustChangePassword: sourceUser.mustChangePassword === true, passwordHash: sourceUser.passwordHash,
        identitySubject: sourceUser.identitySubject as IdentitySubject | undefined,
        fingerprint, existingSubject: existing?.subject });
    }
    const selectedIds = new Set(accounts.map((account) => account.id));
    const journalSources = await this.journal.distinct("sourceStudioUserId", { runId: this.options.runId });
    if (journalSources.some((id) => !selectedIds.has(id))) {
      throw new StudioMigrationGateError("Migration journal contains a source account outside the approved five");
    }
    return accounts;
  }

  private sourceFingerprint(source: StudioSource): string {
    return studioImportFingerprint({ studioUserId: source._id.toHexString(), name: source.name as string,
      email: source.email as string, passwordHash: source.passwordHash as string,
      disabled: source.disabled === true, mustChangePassword: source.mustChangePassword === true,
      applicationIds: [this.options.applicationId] });
  }

  private async assertIndexes(): Promise<void> {
    const identityIndexes = await this.options.target.collection("identity_users").listIndexes().toArray();
    const credentialIndexes = await this.options.target.collection("identity_credentials").listIndexes().toArray();
    const membershipIndexes = await this.options.target.collection("identity_memberships").listIndexes().toArray();
    const journalIndexes = await this.journal.listIndexes().toArray();
    const studioIndexes = await this.options.source.collection("users").listIndexes().toArray();
    if (!identityIndexes.some((index) => index.name === "uniq_provisioning_key" && index.unique === true && index.sparse === true
      && JSON.stringify(index.key) === JSON.stringify({ "provisioning.idempotencyKeyHash": 1 }))
      || !credentialIndexes.some((index) => index.name === "uniq_subject_credential_type" && index.unique === true
        && JSON.stringify(index.key) === JSON.stringify({ identitySubject: 1, type: 1 }))
      || !membershipIndexes.some((index) => index.name === "uniq_subject_application" && index.unique === true
        && JSON.stringify(index.key) === JSON.stringify({ identitySubject: 1, applicationId: 1 }))
      || !journalIndexes.some((index) => index.name === "uniq_source_step" && index.unique === true
        && JSON.stringify(index.key) === JSON.stringify({ sourceStudioUserId: 1, step: 1 }))
      || !studioIndexes.some((index) => index.name === "uniq_identity_subject" && index.unique === true && index.sparse === true
        && JSON.stringify(index.key) === JSON.stringify({ identitySubject: 1 }))) {
      throw new StudioMigrationGateError("Required Identity, journal, or Studio unique index is missing");
    }
  }

  private async steps(sourceStudioUserId: string): Promise<Step[]> {
    return (await this.journal.find({ sourceStudioUserId, runId: this.options.runId }).toArray()).map((entry) => entry.step);
  }

  private async record(sourceStudioUserId: string, subject: IdentitySubject, step: Step): Promise<void> {
    const existing = await this.journal.findOne({ sourceStudioUserId, step });
    if (existing) {
      if (existing.runId !== this.options.runId || existing.subject !== subject) throw new StudioMigrationGateError("Migration journal checkpoint conflict");
      return;
    }
    try {
      await this.journal.insertOne({ _id: new ObjectId(), runId: this.options.runId, sourceStudioUserId, subject, step, occurredAt: new Date() });
    } catch {
      const replay = await this.journal.findOne({ sourceStudioUserId, step });
      if (!replay || replay.runId !== this.options.runId || replay.subject !== subject) throw new StudioMigrationGateError("Migration journal checkpoint conflict");
    }
  }
}
