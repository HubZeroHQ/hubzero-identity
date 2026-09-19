import { MongoServerError, type Db } from "mongodb";
import { identityRateLimitsCollection } from "@/lib/db/collections";
import { hmacSha256 } from "@/lib/security/crypto";
import type { SecurityEventSink } from "@/lib/security/events";
import type { Clock } from "@/lib/time/clock";
import { systemClock } from "@/lib/time/clock";

const namespacePattern = /^[a-z][a-z0-9_.-]{1,63}$/;

export interface RateLimitRequest {
  namespace: string;
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  storageUnavailable?: boolean;
}

export interface RateLimiter {
  consume(request: RateLimitRequest): Promise<RateLimitDecision>;
}

export type RateLimitFailurePolicy = "fail_closed" | "fail_open";

export class RateLimitStorageError extends Error {
  constructor(cause: unknown) {
    super("Rate-limit storage is unavailable", { cause });
    this.name = "RateLimitStorageError";
  }
}

export function buildRateLimitBucketId(namespace: string, key: string, hmacKey: Uint8Array): string {
  if (!namespacePattern.test(namespace)) throw new Error("Invalid rate-limit namespace");
  if (key.length === 0 || key.length > 500) throw new Error("Invalid rate-limit key");
  return hmacSha256(key.normalize("NFC"), hmacKey, `hubzero-identity/rate-limit/v1/${namespace}`);
}

export class MongoFixedWindowRateLimiter implements RateLimiter {
  constructor(
    private database: Db,
    private hmacKey: Uint8Array,
    private events: SecurityEventSink,
    private clock: Clock = systemClock,
  ) {
    if (hmacKey.byteLength < 32) throw new Error("Rate-limit HMAC key must contain at least 32 bytes");
  }

  async consume(request: RateLimitRequest): Promise<RateLimitDecision> {
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1_000_000) throw new Error("Invalid rate-limit allowance");
    if (!Number.isSafeInteger(request.windowSeconds) || request.windowSeconds < 1 || request.windowSeconds > 86_400) throw new Error("Invalid rate-limit window");
    const now = this.clock.now();
    const windowExpiresAt = new Date(now.getTime() + request.windowSeconds * 1000);
    const bucketId = buildRateLimitBucketId(request.namespace, request.key, this.hmacKey);

    try {
      const document = await this.updateBucket(bucketId, request, now, windowExpiresAt);
      const allowed = document.count <= request.limit;
      const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((document.expiresAt.getTime() - now.getTime()) / 1000));
      if (!allowed) {
        await this.events.append("rate_limit.triggered", { namespace: request.namespace, retryAfterSeconds }, { outcome: "failure", reasonCode: "rate_limited" });
      }
      return { allowed, remaining: Math.max(0, request.limit - document.count), retryAfterSeconds };
    } catch (error) {
      throw error instanceof RateLimitStorageError ? error : new RateLimitStorageError(error);
    }
  }

  private async updateBucket(bucketId: string, request: RateLimitRequest, now: Date, windowExpiresAt: Date) {
    const collection = identityRateLimitsCollection(this.database);
    const update = [{ $set: {
      namespace: { $literal: request.namespace },
      count: { $cond: [
        { $or: [{ $eq: [{ $type: "$expiresAt" }, "missing"] }, { $lte: ["$expiresAt", now] }] },
        1,
        { $min: [{ $add: ["$count", 1] }, request.limit + 1] },
      ] },
      windowStartedAt: { $cond: [
        { $or: [{ $eq: [{ $type: "$expiresAt" }, "missing"] }, { $lte: ["$expiresAt", now] }] },
        now,
        "$windowStartedAt",
      ] },
      expiresAt: { $cond: [
        { $or: [{ $eq: [{ $type: "$expiresAt" }, "missing"] }, { $lte: ["$expiresAt", now] }] },
        windowExpiresAt,
        "$expiresAt",
      ] },
      updatedAt: now,
    } }] as const;
    try {
      const result = await collection.findOneAndUpdate({ _id: bucketId }, update, { upsert: true, returnDocument: "after" });
      if (!result) throw new Error("Rate-limit update returned no document");
      return result;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const result = await collection.findOneAndUpdate({ _id: bucketId }, update, { upsert: false, returnDocument: "after" });
        if (result) return result;
      }
      throw error;
    }
  }
}

export async function consumeWithFailurePolicy(
  limiter: RateLimiter,
  request: RateLimitRequest,
  policy: RateLimitFailurePolicy,
): Promise<RateLimitDecision> {
  try {
    return await limiter.consume(request);
  } catch (error) {
    if (!(error instanceof RateLimitStorageError)) throw error;
    return policy === "fail_open"
      ? { allowed: true, remaining: 0, retryAfterSeconds: 0, storageUnavailable: true }
      : { allowed: false, remaining: 0, retryAfterSeconds: 1, storageUnavailable: true };
  }
}
