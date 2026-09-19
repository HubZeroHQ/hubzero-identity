import { ObjectId, type ClientSession, type Db } from "mongodb";
import { monotonicFactory } from "ulid";
import type { ApplicationId } from "@/domain/applications";
import type { IdentitySubject } from "@/domain/identity";
import {
  assertSafeEventMetadata,
  type SecurityEventMetadataByType,
  type SecurityEventType,
} from "@/domain/security-events";
import { identitySecurityEventsCollection } from "@/lib/db/collections";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";

const createUlid = monotonicFactory();

export interface SecurityEventContext {
  actorSubject?: IdentitySubject | null;
  targetSubject?: IdentitySubject | null;
  applicationId?: ApplicationId | null;
  requestId?: string | null;
  ipPrefix?: string | null;
  outcome?: "success" | "failure";
  reasonCode?: string | null;
}

export interface SecurityEventSink {
  append<T extends SecurityEventType>(
    type: T,
    metadata: SecurityEventMetadataByType[T],
    context?: SecurityEventContext,
    session?: ClientSession,
  ): Promise<string>;
}

export class MongoSecurityEventWriter implements SecurityEventSink {
  constructor(private database: Db, private clock: Clock = systemClock) {}

  async append<T extends SecurityEventType>(
    type: T,
    metadata: SecurityEventMetadataByType[T],
    context: SecurityEventContext = {},
    session?: ClientSession,
  ): Promise<string> {
    assertSafeEventMetadata(metadata, type);
    const id = `evt_${createUlid(this.clock.now().getTime())}`;
    await identitySecurityEventsCollection(this.database).insertOne({
      _id: new ObjectId(),
      id,
      type,
      occurredAt: this.clock.now(),
      actorSubject: context.actorSubject ?? null,
      targetSubject: context.targetSubject ?? null,
      applicationId: context.applicationId ?? null,
      requestId: context.requestId ?? null,
      ipPrefix: context.ipPrefix ?? null,
      outcome: context.outcome ?? "success",
      reasonCode: context.reasonCode ?? null,
      metadata: { ...metadata },
    }, { session });
    return id;
  }
}
