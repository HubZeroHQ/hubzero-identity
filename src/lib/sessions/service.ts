import { ObjectId, type Db, type MongoClient } from "mongodb";
import { monotonicFactory } from "ulid";
import { sessionPolicy } from "@/domain/sessions";
import type { IdentitySubject } from "@/domain/identity";
import { identitySessionsCollection, identityUsersCollection } from "@/lib/db/collections";
import { withRequiredTransaction } from "@/lib/db/transaction";
import { constantTimeEqual } from "@/lib/security/crypto";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";
import { createSessionSecret, hashSessionSecret, parseSessionToken } from "./session-secret";

const createUlid = monotonicFactory();

export const identitySessionCookie = {
  name: "__Host-hz_session",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  domain: undefined,
  maxAgeSeconds: sessionPolicy.absoluteLifetimeSeconds,
} as const;

export interface CreateSessionInput {
  identitySubject: IdentitySubject;
  userAgentSummary?: string | null;
  ipPrefix?: string | null;
  /** Preserve the original credential-proof time when replacing a session. */
  authenticatedAt?: Date;
}

export interface SessionAuditEvent {
  type: "login.succeeded";
  metadata: { credentialAlgorithm: "argon2id" | "bcrypt" };
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  authenticatedAt: Date;
}

export interface ValidatedSession {
  sessionId: string;
  identitySubject: IdentitySubject;
  rotatedToken: string | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  needsRotation: boolean;
  authenticatedAt: Date;
}

export interface SessionValidationOptions {
  allowRotation?: boolean;
}

export class SessionService {
  constructor(
    private database: Db,
    private client: MongoClient,
    private hmacKey: Uint8Array,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {
    if (hmacKey.byteLength < 32) throw new Error("Session HMAC key must contain at least 32 bytes");
  }

  async create(input: CreateSessionInput, additionalEvent?: SessionAuditEvent): Promise<CreatedSession> {
    const now = this.clock.now();
    const sessionId = `ses_${createUlid(now.getTime())}`;
    const material = createSessionSecret(sessionId);
    const idleExpiresAt = addSeconds(now, sessionPolicy.idleLifetimeSeconds);
    const absoluteExpiresAt = addSeconds(now, sessionPolicy.absoluteLifetimeSeconds);
    const authenticatedAt = input.authenticatedAt ?? now;

    await withRequiredTransaction(this.client, async (session) => {
      const account = await identityUsersCollection(this.database).findOne({ subject: input.identitySubject, status: "active" }, { session });
      if (!account) throw new Error("Active account not found");
      await identitySessionsCollection(this.database).insertOne({
        _id: new ObjectId(),
        id: sessionId,
        identitySubject: input.identitySubject,
        currentSecretHash: hashSessionSecret(sessionId, material.secret, this.hmacKey),
        previousSecretHash: null,
        previousSecretValidUntil: null,
        secretHashVersion: 1,
        sessionVersion: account.sessionVersion,
        authenticatedAt,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        rotatedAt: now,
        revokedAt: null,
        revokeReason: null,
        userAgentSummary: input.userAgentSummary?.slice(0, 160) ?? null,
        ipPrefix: input.ipPrefix?.slice(0, 80) ?? null,
      }, { session });
      await this.events.append("session.created", { sessionId }, { targetSubject: input.identitySubject }, session);
      if (additionalEvent) {
        await this.events.append(additionalEvent.type, additionalEvent.metadata, { targetSubject: input.identitySubject }, session);
      }
      return true;
    });
    return { sessionId, token: material.token, idleExpiresAt, absoluteExpiresAt, authenticatedAt };
  }

  async validate(token: string, options: SessionValidationOptions = {}): Promise<ValidatedSession | null> {
    const parsed = parseSessionToken(token);
    if (!parsed) return null;
    const sessions = identitySessionsCollection(this.database);
    let record = await sessions.findOne({ id: parsed.sessionId });
    if (!record || record.secretHashVersion !== 1) return null;
    const now = this.clock.now();
    const suppliedHash = hashSessionSecret(record.id, parsed.secret, this.hmacKey);
    const currentMatches = constantTimeEqual(suppliedHash, record.currentSecretHash);
    const previousMatches = record.previousSecretHash !== null
      && record.previousSecretValidUntil !== null
      && record.previousSecretValidUntil > now
      && constantTimeEqual(suppliedHash, record.previousSecretHash);
    if (!currentMatches && !previousMatches) return null;
    if (!isRecordTimeValid(record, now)) return null;

    const account = await identityUsersCollection(this.database).findOne({ subject: record.identitySubject });
    if (!account || account.status !== "active" || account.sessionVersion !== record.sessionVersion) return null;
    const nextIdleExpiry = minDate(addSeconds(now, sessionPolicy.idleLifetimeSeconds), record.absoluteExpiresAt);

    const needsRotation = currentMatches && now.getTime() - record.rotatedAt.getTime() >= sessionPolicy.rotateAfterSeconds * 1000;
    if (needsRotation && options.allowRotation !== false) {
      const nextMaterial = createSessionSecret(record.id);
      const nextHash = hashSessionSecret(record.id, nextMaterial.secret, this.hmacKey);
      const previousSecretValidUntil = addSeconds(now, sessionPolicy.previousSecretGraceSeconds);
      const rotated = await withRequiredTransaction(this.client, async (session) => {
        const rotation = await sessions.updateOne({
          _id: record!._id,
          currentSecretHash: record!.currentSecretHash,
          revokedAt: null,
          sessionVersion: account.sessionVersion,
          idleExpiresAt: { $gt: now },
          absoluteExpiresAt: { $gt: now },
        }, { $set: {
          currentSecretHash: nextHash,
          previousSecretHash: record!.currentSecretHash,
          previousSecretValidUntil,
          rotatedAt: now,
          lastSeenAt: now,
          idleExpiresAt: nextIdleExpiry,
        } }, { session });
        if (rotation.modifiedCount !== 1) return false;
        await this.events.append("session.rotated", { sessionId: record!.id }, { targetSubject: record!.identitySubject }, session);
        return true;
      });
      if (rotated) {
        return { sessionId: record.id, identitySubject: record.identitySubject, rotatedToken: nextMaterial.token, idleExpiresAt: nextIdleExpiry, absoluteExpiresAt: record.absoluteExpiresAt, needsRotation: false, authenticatedAt: record.authenticatedAt };
      }
      record = await sessions.findOne({ _id: record._id });
      if (!record || record.revokedAt || !record.previousSecretHash || !record.previousSecretValidUntil || record.previousSecretValidUntil <= now || !constantTimeEqual(suppliedHash, record.previousSecretHash)) return null;
    }

    const shouldTouch = now.getTime() - record.lastSeenAt.getTime() >= sessionPolicy.activityUpdateAfterSeconds * 1000;
    if (!shouldTouch) {
      return { sessionId: record.id, identitySubject: record.identitySubject, rotatedToken: null, idleExpiresAt: record.idleExpiresAt, absoluteExpiresAt: record.absoluteExpiresAt, needsRotation, authenticatedAt: record.authenticatedAt };
    }
    const touch = await sessions.updateOne({
      _id: record._id,
      revokedAt: null,
      sessionVersion: account.sessionVersion,
      idleExpiresAt: { $gt: now },
      absoluteExpiresAt: { $gt: now },
      $or: [
        { currentSecretHash: suppliedHash },
        { previousSecretHash: suppliedHash, previousSecretValidUntil: { $gt: now } },
      ],
    }, { $set: { lastSeenAt: now, idleExpiresAt: nextIdleExpiry } });
    if (touch.matchedCount !== 1) return null;
    return { sessionId: record.id, identitySubject: record.identitySubject, rotatedToken: null, idleExpiresAt: nextIdleExpiry, absoluteExpiresAt: record.absoluteExpiresAt, needsRotation, authenticatedAt: record.authenticatedAt };
  }

  async revoke(sessionId: string, actorSubject: IdentitySubject, reason: string): Promise<boolean> {
    return withRequiredTransaction(this.client, async (session) => {
      const now = this.clock.now();
      const result = await identitySessionsCollection(this.database).findOneAndUpdate(
        { id: sessionId, revokedAt: null },
        { $set: { revokedAt: now, revokeReason: reason, previousSecretValidUntil: now } },
        { session, returnDocument: "after" },
      );
      if (!result) return false;
      await this.events.append("session.revoked", { sessionId, reason }, { actorSubject, targetSubject: result.identitySubject }, session);
      return true;
    });
  }

  async revokeAll(identitySubject: IdentitySubject, actorSubject: IdentitySubject, reason: string): Promise<number> {
    return withRequiredTransaction(this.client, async (session) => {
      const now = this.clock.now();
      const account = await identityUsersCollection(this.database).findOneAndUpdate(
        { subject: identitySubject },
        { $inc: { sessionVersion: 1 }, $set: { updatedAt: now } },
        { session, returnDocument: "after" },
      );
      if (!account) throw new Error("Account not found");
      const revoked = await identitySessionsCollection(this.database).updateMany(
        { identitySubject, revokedAt: null },
        { $set: { revokedAt: now, revokeReason: reason, previousSecretValidUntil: now } },
        { session },
      );
      await this.events.append("session.all_revoked", { reason, revokedCount: revoked.modifiedCount }, { actorSubject, targetSubject: identitySubject }, session);
      return revoked.modifiedCount;
    });
  }

  async listActive(identitySubject: IdentitySubject, currentSessionId: string) {
    const now = this.clock.now();
    return identitySessionsCollection(this.database).find({
      identitySubject,
      revokedAt: null,
      idleExpiresAt: { $gt: now },
      absoluteExpiresAt: { $gt: now },
    }, { projection: { currentSecretHash: 0, previousSecretHash: 0 } }).sort({ lastSeenAt: -1 }).toArray().then((sessions) => sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: new Date(Math.min(session.idleExpiresAt.getTime(), session.absoluteExpiresAt.getTime())),
      userAgentSummary: session.userAgentSummary,
    })));
  }

  async revokeOwned(identitySubject: IdentitySubject, sessionId: string, reason: string): Promise<boolean> {
    const owned = await identitySessionsCollection(this.database).findOne({ id: sessionId, identitySubject }, { projection: { _id: 1 } });
    if (!owned) return false;
    return this.revoke(sessionId, identitySubject, reason);
  }

  async replaceAllWithFreshSession(input: CreateSessionInput, reason: string): Promise<CreatedSession & { revokedCount: number }> {
    const now = this.clock.now();
    const sessionId = `ses_${createUlid(now.getTime())}`;
    const material = createSessionSecret(sessionId);
    const idleExpiresAt = addSeconds(now, sessionPolicy.idleLifetimeSeconds);
    const absoluteExpiresAt = addSeconds(now, sessionPolicy.absoluteLifetimeSeconds);
    const authenticatedAt = input.authenticatedAt ?? now;
    return withRequiredTransaction(this.client, async (session) => {
      const account = await identityUsersCollection(this.database).findOneAndUpdate({ subject: input.identitySubject, status: "active" }, {
        $inc: { sessionVersion: 1 },
        $set: { updatedAt: now },
      }, { session, returnDocument: "after" });
      if (!account) throw new Error("Active account not found");
      const revoked = await identitySessionsCollection(this.database).updateMany({ identitySubject: input.identitySubject, revokedAt: null }, {
        $set: { revokedAt: now, revokeReason: reason, previousSecretValidUntil: now },
      }, { session });
      await identitySessionsCollection(this.database).insertOne({
        _id: new ObjectId(),
        id: sessionId,
        identitySubject: input.identitySubject,
        currentSecretHash: hashSessionSecret(sessionId, material.secret, this.hmacKey),
        previousSecretHash: null,
        previousSecretValidUntil: null,
        secretHashVersion: 1,
        sessionVersion: account.sessionVersion,
        authenticatedAt,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        rotatedAt: now,
        revokedAt: null,
        revokeReason: null,
        userAgentSummary: input.userAgentSummary?.slice(0, 160) ?? null,
        ipPrefix: input.ipPrefix?.slice(0, 80) ?? null,
      }, { session });
      await this.events.append("session.other_sessions_revoked", { reason, revokedCount: revoked.modifiedCount }, { actorSubject: input.identitySubject, targetSubject: input.identitySubject }, session);
      await this.events.append("session.created", { sessionId }, { targetSubject: input.identitySubject }, session);
      return { sessionId, token: material.token, idleExpiresAt, absoluteExpiresAt, authenticatedAt, revokedCount: revoked.modifiedCount };
    });
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function minDate(left: Date, right: Date): Date {
  return left < right ? left : right;
}

function isRecordTimeValid(record: { revokedAt: Date | null; idleExpiresAt: Date; absoluteExpiresAt: Date }, now: Date): boolean {
  return record.revokedAt === null && record.idleExpiresAt > now && record.absoluteExpiresAt > now;
}
