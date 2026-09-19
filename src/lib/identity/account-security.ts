import type { Db, MongoClient } from "mongodb";
import type { IdentitySubject } from "@/domain/identity";
import { identitySessionsCollection, identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";

export class AccountSecurityService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {}

  async suspend(identitySubject: IdentitySubject, actorSubject: IdentitySubject, reason: string): Promise<void> {
    await withRequiredTransaction(this.client, async (session) => {
      const now = this.clock.now();
      const account = await identityUsersCollection(this.database).findOneAndUpdate(
        { subject: identitySubject, status: "active" },
        { $set: { status: "suspended", updatedAt: now }, $inc: { sessionVersion: 1 } },
        { session, returnDocument: "after" },
      );
      if (!account) throw new Error("Active account not found");
      const revoked = await identitySessionsCollection(this.database).updateMany(
        { identitySubject, revokedAt: null },
        { $set: { revokedAt: now, revokeReason: "account_suspended", previousSecretValidUntil: now } },
        { session },
      );
      await this.events.append("session.all_revoked", { reason: "account_suspended", revokedCount: revoked.modifiedCount }, { actorSubject, targetSubject: identitySubject }, session);
      await this.events.append("account.suspended", { reason }, { actorSubject, targetSubject: identitySubject }, session);
      return true;
    });
  }

  async restore(identitySubject: IdentitySubject, actorSubject: IdentitySubject, reason: string): Promise<void> {
    await withRequiredTransaction(this.client, async (session) => {
      const now = this.clock.now();
      const account = await identityUsersCollection(this.database).findOneAndUpdate(
        { subject: identitySubject, status: "suspended" },
        { $set: { status: "active", updatedAt: now }, $inc: { sessionVersion: 1 } },
        { session, returnDocument: "after" },
      );
      if (!account) throw new Error("Suspended account not found");
      await this.events.append("account.restored", { reason }, { actorSubject, targetSubject: identitySubject }, session);
      return true;
    });
  }
}
