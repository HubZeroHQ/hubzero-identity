import { ObjectId, type Db, type MongoClient } from "mongodb";
import { monotonicFactory } from "ulid";
import type { IdentitySubject } from "@/domain/identity";
import { identityCredentialsCollection, identitySessionsCollection, identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import type { SecurityEventSink } from "@/lib/security/events";
import { createSessionSecret, hashSessionSecret } from "@/lib/sessions/session-secret";
import type { PasswordService } from "./password";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";
import { sessionPolicy } from "@/domain/sessions";

const createUlid = monotonicFactory();

export class CurrentPasswordRejectedError extends Error {
  constructor() {
    super("Current password was rejected");
    this.name = "CurrentPasswordRejectedError";
  }
}

export class ConcurrentPasswordChangeError extends Error {
  constructor() {
    super("Password changed concurrently");
    this.name = "ConcurrentPasswordChangeError";
  }
}

export interface PasswordChangeResult {
  token: string;
  absoluteExpiresAt: Date;
  revokedCount: number;
}

export class AccountPasswordService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private passwords: PasswordService,
    private sessionHmacKey: Uint8Array,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {}

  async change(input: { identitySubject: IdentitySubject; currentPassword: string; newPassword: string; userAgentSummary?: string | null; ipPrefix?: string | null; forced: boolean }): Promise<PasswordChangeResult> {
    const credentials = identityCredentialsCollection(this.database);
    const existing = await credentials.findOne({ identitySubject: input.identitySubject, type: "password" });
    if (!existing) throw new CurrentPasswordRejectedError();
    const verification = await this.passwords.verify(existing, input.currentPassword);
    if (!verification.valid) throw new CurrentPasswordRejectedError();
    const replacementHash = await this.passwords.hash(input.newPassword);
    const now = this.clock.now();
    const sessionId = `ses_${createUlid(now.getTime())}`;
    const material = createSessionSecret(sessionId);
    const absoluteExpiresAt = new Date(now.getTime() + sessionPolicy.absoluteLifetimeSeconds * 1000);
    const idleExpiresAt = new Date(now.getTime() + sessionPolicy.idleLifetimeSeconds * 1000);

    return withRequiredTransaction(this.client, async (transaction) => {
      const credentialUpdate = await credentials.updateOne({ _id: existing._id, passwordHash: existing.passwordHash }, {
        $set: {
          passwordHash: replacementHash,
          algorithm: "argon2id",
          algorithmParameters: { ...this.passwords.parameters },
          mustChangePassword: false,
          passwordChangedAt: now,
          updatedAt: now,
        },
      }, { session: transaction });
      if (credentialUpdate.modifiedCount !== 1) throw new ConcurrentPasswordChangeError();
      const account = await identityUsersCollection(this.database).findOneAndUpdate({ subject: input.identitySubject, status: "active" }, {
        $inc: { sessionVersion: 1 },
        $set: { updatedAt: now },
      }, { session: transaction, returnDocument: "after" });
      if (!account) throw new CurrentPasswordRejectedError();
      const revoked = await identitySessionsCollection(this.database).updateMany({ identitySubject: input.identitySubject, revokedAt: null }, {
        $set: { revokedAt: now, revokeReason: "password_changed", previousSecretValidUntil: now },
      }, { session: transaction });
      await identitySessionsCollection(this.database).insertOne({
        _id: new ObjectId(),
        id: sessionId,
        identitySubject: input.identitySubject,
        currentSecretHash: hashSessionSecret(sessionId, material.secret, this.sessionHmacKey),
        previousSecretHash: null,
        previousSecretValidUntil: null,
        secretHashVersion: 1,
        sessionVersion: account.sessionVersion,
        authenticatedAt: now,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        rotatedAt: now,
        revokedAt: null,
        revokeReason: null,
        userAgentSummary: input.userAgentSummary?.slice(0, 160) ?? null,
        ipPrefix: input.ipPrefix?.slice(0, 80) ?? null,
      }, { session: transaction });
      await this.events.append("password.changed", { sessionsInvalidated: true }, { actorSubject: input.identitySubject, targetSubject: input.identitySubject }, transaction);
      if (input.forced) await this.events.append("password.forced_change_completed", { sessionsInvalidated: true }, { actorSubject: input.identitySubject, targetSubject: input.identitySubject }, transaction);
      await this.events.append("session.all_revoked", { reason: "password_changed", revokedCount: revoked.modifiedCount }, { actorSubject: input.identitySubject, targetSubject: input.identitySubject }, transaction);
      await this.events.append("session.created", { sessionId }, { targetSubject: input.identitySubject }, transaction);
      return { token: material.token, absoluteExpiresAt, revokedCount: revoked.modifiedCount };
    });
  }
}
