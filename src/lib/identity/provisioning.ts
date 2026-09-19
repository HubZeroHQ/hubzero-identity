import { MongoServerError, ObjectId, type Db, type MongoClient } from "mongodb";
import { z } from "zod";
import type { ApplicationId } from "@/domain/applications";
import type { IdentitySubject } from "@/domain/identity";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection, identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import type { CredentialService } from "@/lib/credentials/service";
import type { SecurityEventSink } from "@/lib/security/events";
import { sha256 } from "@/lib/security/crypto";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";
import { normalizeEmail } from "./email";
import { generateIdentitySubject } from "./subject";

const provisioningSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().min(1).max(320),
  password: z.string(),
  accountType: z.enum(["internal", "standard"]).default("internal"),
  mustChangePassword: z.boolean().default(false),
  applicationIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/)).max(20).default([]),
  idempotencyKey: z.string().min(16).max(200),
  actorSubject: z.string().regex(/^hz_[0-9A-HJKMNP-TV-Z]{26}$/),
  reason: z.string().trim().min(3).max(240),
});

export type ProvisionAccountInput = z.input<typeof provisioningSchema>;

export interface ProvisionAccountResult {
  created: boolean;
  subject: IdentitySubject;
  email: string;
  applicationIds: readonly ApplicationId[];
}

export class ProvisioningConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningConflictError";
  }
}

export class ProvisioningService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private credentials: CredentialService,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {}

  async provision(rawInput: ProvisionAccountInput): Promise<ProvisionAccountResult> {
    const input = provisioningSchema.parse(rawInput);
    const normalized = normalizeEmail(input.email);
    const applicationIds = [...new Set(input.applicationIds)].sort() as ApplicationId[];
    const idempotencyKeyHash = sha256(input.idempotencyKey);
    const inputFingerprint = sha256(JSON.stringify({
      name: input.name,
      normalizedEmail: normalized.normalizedEmail,
      accountType: input.accountType,
      mustChangePassword: input.mustChangePassword,
      applicationIds,
    }));
    const actorSubject = input.actorSubject as IdentitySubject;
    const existing = await identityUsersCollection(this.database).findOne({ "provisioning.idempotencyKeyHash": idempotencyKeyHash });
    if (existing) return this.replayExisting(existing.subject, existing.email, existing.provisioning.inputFingerprint, inputFingerprint, applicationIds, actorSubject, input.reason);

    const subject = generateIdentitySubject(this.clock.now());
    const credential = await this.credentials.buildNewPasswordCredential(subject, input.password, input.mustChangePassword);

    try {
      return await withRequiredTransaction(this.client, async (session) => {
        const replay = await identityUsersCollection(this.database).findOne({ "provisioning.idempotencyKeyHash": idempotencyKeyHash }, { session });
        if (replay) {
          if (replay.provisioning.inputFingerprint !== inputFingerprint) throw new ProvisioningConflictError("Idempotency key was already used with different account details");
          const currentMemberships = await identityMembershipsCollection(this.database).find({ identitySubject: replay.subject, status: "active" }, { session }).toArray();
          if (!sameMemberships(currentMemberships.map((item) => item.applicationId), applicationIds)) {
            throw new ProvisioningConflictError("Existing memberships no longer match the original provisioning request");
          }
          await this.events.append("admin.operation", { operation: "provision.account.replay", reason: input.reason }, { actorSubject, targetSubject: replay.subject }, session);
          return { created: false, subject: replay.subject, email: replay.email, applicationIds };
        }

        if (applicationIds.length > 0) {
          const applications = await identityApplicationsCollection(this.database).find({ id: { $in: applicationIds }, enabled: true }, { session }).toArray();
          if (applications.length !== applicationIds.length) throw new ProvisioningConflictError("One or more requested applications do not exist or are disabled");
        }

        const now = this.clock.now();
        await identityUsersCollection(this.database).insertOne({
          _id: new ObjectId(),
          subject,
          normalizedEmail: normalized.normalizedEmail,
          emailNormalizationVersion: normalized.version,
          email: normalized.email,
          emailVerifiedAt: null,
          name: input.name,
          imageUrl: null,
          accountType: input.accountType,
          status: "active",
          sessionVersion: 1,
          provisioning: { idempotencyKeyHash, inputFingerprint },
          createdAt: now,
          updatedAt: now,
        }, { session });
        await identityCredentialsCollection(this.database).insertOne(credential, { session });
        if (applicationIds.length > 0) {
          await identityMembershipsCollection(this.database).insertMany(applicationIds.map((applicationId) => ({
            _id: new ObjectId(), identitySubject: subject, applicationId, status: "active" as const, createdAt: now, updatedAt: now,
          })), { session });
        }
        await this.events.append("credential.created", { algorithm: "argon2id", mustChangePassword: input.mustChangePassword }, { actorSubject, targetSubject: subject }, session);
        for (const applicationId of applicationIds) {
          await this.events.append("membership.granted", { status: "active" }, { actorSubject, targetSubject: subject, applicationId }, session);
        }
        await this.events.append("account.provisioned", {
          accountType: input.accountType,
          membershipCount: applicationIds.length,
          idempotentReplay: false,
        }, { actorSubject, targetSubject: subject }, session);
        return { created: true, subject, email: normalized.email, applicationIds };
      });
    } catch (error) {
      if (error instanceof ProvisioningConflictError) {
        await this.auditConflict(actorSubject, error.message);
        throw error;
      }
      if (error instanceof MongoServerError && error.code === 11000) {
        const replay = await identityUsersCollection(this.database).findOne({ "provisioning.idempotencyKeyHash": idempotencyKeyHash });
        if (replay) return this.replayExisting(replay.subject, replay.email, replay.provisioning.inputFingerprint, inputFingerprint, applicationIds, actorSubject, input.reason);
        const emailOwner = await identityUsersCollection(this.database).findOne({ normalizedEmail: normalized.normalizedEmail });
        if (emailOwner) {
          await this.auditConflict(actorSubject, "Canonical email is already provisioned");
          throw new ProvisioningConflictError("Canonical email is already provisioned");
        }
        throw error;
      }
      throw error;
    }
  }

  private async replayExisting(subject: IdentitySubject, email: string, existingFingerprint: string, expectedFingerprint: string, applicationIds: ApplicationId[], actorSubject: IdentitySubject, reason: string): Promise<ProvisionAccountResult> {
    if (existingFingerprint !== expectedFingerprint) {
      await this.auditConflict(actorSubject, "Idempotency key was reused with incompatible input");
      throw new ProvisioningConflictError("Idempotency key was already used with different account details");
    }
    const currentMemberships = await identityMembershipsCollection(this.database).find({ identitySubject: subject, status: "active" }).toArray();
    if (!sameMemberships(currentMemberships.map((item) => item.applicationId), applicationIds)) {
      await this.auditConflict(actorSubject, "Existing memberships no longer match the original provisioning request");
      throw new ProvisioningConflictError("Existing memberships no longer match the original provisioning request");
    }
    await withRequiredTransaction(this.client, async (session) => {
      await this.events.append("admin.operation", { operation: "provision.account.replay", reason }, { actorSubject, targetSubject: subject }, session);
      return true;
    });
    return { created: false, subject, email, applicationIds };
  }

  private async auditConflict(actorSubject: IdentitySubject, reason: string): Promise<void> {
    await this.events.append("provisioning.conflict", { reason }, { actorSubject, outcome: "failure", reasonCode: "provisioning_conflict" });
  }
}

function sameMemberships(left: readonly ApplicationId[], right: readonly ApplicationId[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
