import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient } from "mongodb";
import { monotonicFactory } from "ulid";
import { z } from "zod";
import type { ApplicationId } from "@/domain/applications";
import type { IdentitySubject } from "@/domain/identity";
import { identityApplicationsCollection, identityCredentialsCollection, identityMembershipsCollection, identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import { normalizeEmail } from "@/lib/identity/email";
import { generateIdentitySubject } from "@/lib/identity/subject";
import { sha256 } from "@/lib/security/crypto";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";
import { parseBcryptHash } from "@/lib/credentials/password";

const createUlid = monotonicFactory();

const sourceSchema = z.object({
  studioUserId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().min(1).max(320),
  passwordHash: z.string().min(1),
  disabled: z.boolean(),
  mustChangePassword: z.boolean(),
  applicationIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/)).max(20),
  actorSubject: z.string().regex(/^hz_[0-9A-HJKMNP-TV-Z]{26}$/),
  reason: z.string().trim().min(3).max(240),
});

export type StudioLegacyImportInput = z.input<typeof sourceSchema>;

export class StudioLegacyImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioLegacyImportConflictError";
  }
}

/**
 * Phase 6's eventual apply primitive, exercised only against isolated MongoDB
 * in Phase 5. It owns the Identity-side transaction; Studio mapping writes are
 * deliberately external because the two products do not share a transaction.
 */
export class StudioLegacyImportService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {}

  async import(rawInput: StudioLegacyImportInput): Promise<{ created: boolean; subject: IdentitySubject; applicationIds: ApplicationId[] }> {
    const input = sourceSchema.parse(rawInput);
    const normalized = normalizeEmail(input.email);
    const bcryptParameters = parseBcryptHash(input.passwordHash);
    const applicationIds = [...new Set(input.applicationIds)].sort() as ApplicationId[];
    const sourceKeyHash = sha256(`studio-source:${input.studioUserId.toLowerCase()}`);
    const fingerprint = sha256(JSON.stringify({
      studioUserId: input.studioUserId.toLowerCase(),
      normalizedEmail: normalized.normalizedEmail,
      name: input.name,
      disabled: input.disabled,
      mustChangePassword: input.mustChangePassword,
      applicationIds,
      bcryptVersion: bcryptParameters.version,
      bcryptCost: bcryptParameters.cost,
      bcryptHashFingerprint: sha256(input.passwordHash),
    }));
    const actor = input.actorSubject as IdentitySubject;

    try {
      return await withRequiredTransaction(this.client, async (session) => {
        const replay = await identityUsersCollection(this.database).findOne(
          { "provisioning.idempotencyKeyHash": sourceKeyHash },
          { session },
        );
        if (replay) {
          if (replay.provisioning.inputFingerprint !== fingerprint) {
            throw new StudioLegacyImportConflictError("Studio source record changed since its previous migration import");
          }
          await assertMemberships(this.database, replay.subject, applicationIds, session);
          await this.events.append("admin.operation", { operation: "migration.studio.import.replay", reason: input.reason }, { actorSubject: actor, targetSubject: replay.subject }, session);
          return { created: false, subject: replay.subject, applicationIds };
        }

        const emailOwner = await identityUsersCollection(this.database).findOne({ normalizedEmail: normalized.normalizedEmail }, { session });
        if (emailOwner) throw new StudioLegacyImportConflictError("Canonical email already belongs to another Identity account");
        if (applicationIds.length > 0) {
          const applications = await identityApplicationsCollection(this.database)
            .find({ id: { $in: applicationIds }, enabled: true }, { session })
            .toArray();
          if (applications.length !== applicationIds.length) {
            throw new StudioLegacyImportConflictError("One or more approved applications do not exist or are disabled");
          }
        }

        const now = this.clock.now();
        const subject = generateIdentitySubject(now);
        await identityUsersCollection(this.database).insertOne({
          _id: new ObjectId(),
          subject,
          normalizedEmail: normalized.normalizedEmail,
          emailNormalizationVersion: normalized.version,
          email: normalized.email,
          // A source email is administratively known, not cryptographically
          // verified. Do not manufacture a misleading standard OIDC claim.
          emailVerifiedAt: null,
          name: input.name,
          imageUrl: null,
          accountType: "internal",
          status: input.disabled ? "suspended" : "active",
          sessionVersion: 1,
          provisioning: { idempotencyKeyHash: sourceKeyHash, inputFingerprint: fingerprint },
          createdAt: now,
          updatedAt: now,
        }, { session });
        await identityCredentialsCollection(this.database).insertOne({
          _id: new ObjectId(),
          id: `cred_${createUlid(now.getTime())}`,
          identitySubject: subject,
          type: "password",
          passwordHash: input.passwordHash,
          algorithm: "bcrypt",
          algorithmParameters: bcryptParameters,
          mustChangePassword: input.mustChangePassword,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        }, { session });
        if (applicationIds.length > 0) {
          await identityMembershipsCollection(this.database).insertMany(applicationIds.map((applicationId) => ({
            _id: new ObjectId(),
            identitySubject: subject,
            applicationId,
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
          })), { session });
        }
        await this.events.append("credential.created", { algorithm: "bcrypt", mustChangePassword: input.mustChangePassword }, { actorSubject: actor, targetSubject: subject }, session);
        for (const applicationId of applicationIds) {
          await this.events.append("membership.granted", { status: "active" }, { actorSubject: actor, targetSubject: subject, applicationId }, session);
        }
        await this.events.append("account.provisioned", { accountType: "internal", membershipCount: applicationIds.length, idempotentReplay: false }, { actorSubject: actor, targetSubject: subject }, session);
        await this.events.append("admin.operation", { operation: "migration.studio.import", reason: input.reason }, { actorSubject: actor, targetSubject: subject }, session);
        return { created: true, subject, applicationIds };
      });
    } catch (error) {
      if (error instanceof StudioLegacyImportConflictError) {
        await this.events.append("provisioning.conflict", { reason: error.message }, { actorSubject: actor, outcome: "failure", reasonCode: "migration_conflict" });
      }
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new StudioLegacyImportConflictError("Migration uniqueness constraint failed; reconcile before retrying");
      }
      throw error;
    }
  }
}

async function assertMemberships(
  database: Db,
  subject: IdentitySubject,
  expected: ApplicationId[],
  session: ClientSession,
): Promise<void> {
  const memberships = await identityMembershipsCollection(database)
    .find({ identitySubject: subject, status: "active" }, { session })
    .toArray();
  const actual = memberships.map((membership) => membership.applicationId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new StudioLegacyImportConflictError("Existing Identity memberships differ from the approved Studio migration input");
  }
}
