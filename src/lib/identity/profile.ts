import type { Db, MongoClient } from "mongodb";
import type { IdentitySubject } from "@/domain/identity";
import { identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";

export class ProfileService {
  constructor(private database: Db, private client: MongoClient, private events: SecurityEventSink, private clock: Clock = systemClock) {}

  async changeName(identitySubject: IdentitySubject, name: string): Promise<boolean> {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (normalized.length < 1 || normalized.length > 120) throw new Error("Display name must contain between 1 and 120 characters");
    return withRequiredTransaction(this.client, async (session) => {
      const result = await identityUsersCollection(this.database).updateOne({ subject: identitySubject, status: "active" }, { $set: { name: normalized, updatedAt: this.clock.now() } }, { session });
      if (result.matchedCount !== 1) return false;
      if (result.modifiedCount) await this.events.append("profile.changed", { changedFields: "name" }, { actorSubject: identitySubject, targetSubject: identitySubject }, session);
      return result.modifiedCount === 1;
    });
  }
}
