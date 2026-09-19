import type { ApplicationId } from "./applications";
import type { IdentitySubject } from "./identity";

export const securityEventTypes = [
  "account.provisioned",
  "credential.created",
  "account.suspended",
  "account.restored",
  "login.succeeded",
  "login.failed",
  "password.changed",
  "password.forced_change_completed",
  "profile.changed",
  "password.legacy_migrated",
  "session.created",
  "session.rotated",
  "session.revoked",
  "session.all_revoked",
  "session.other_sessions_revoked",
  "membership.granted",
  "membership.revoked",
  "admin.operation",
  "provisioning.conflict",
  "rate_limit.triggered",
] as const;

export type SecurityEventType = (typeof securityEventTypes)[number];

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  occurredAt: Date;
  actorSubject: IdentitySubject | null;
  targetSubject: IdentitySubject | null;
  applicationId: ApplicationId | null;
  requestId: string | null;
  ipPrefix: string | null;
  outcome: "success" | "failure";
  reasonCode: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export type SecurityEventMetadataByType = {
  "account.provisioned": { accountType: "internal" | "standard"; membershipCount: number; idempotentReplay: boolean };
  "credential.created": { algorithm: "argon2id" | "bcrypt"; mustChangePassword: boolean };
  "account.suspended": { reason: string };
  "account.restored": { reason: string };
  "login.succeeded": { credentialAlgorithm: "argon2id" | "bcrypt" };
  "login.failed": { reason: string };
  "password.changed": { sessionsInvalidated: boolean };
  "password.forced_change_completed": { sessionsInvalidated: boolean };
  "profile.changed": { changedFields: string };
  "password.legacy_migrated": { fromAlgorithm: "bcrypt"; toAlgorithm: "argon2id"; legacyCost: number };
  "session.created": { sessionId: string };
  "session.rotated": { sessionId: string };
  "session.revoked": { sessionId: string; reason: string };
  "session.all_revoked": { reason: string; revokedCount: number };
  "session.other_sessions_revoked": { reason: string; revokedCount: number };
  "membership.granted": { status: "active" };
  "membership.revoked": { previousStatus: "active" | "disabled" };
  "admin.operation": { operation: string; reason: string };
  "provisioning.conflict": { reason: string };
  "rate_limit.triggered": { namespace: string; retryAfterSeconds: number };
};

const forbiddenMetadataKeys = new Set([
  "password",
  "passwordhash",
  "sessionsecret",
  "secret",
  "cookie",
  "authorizationcode",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "privatekey",
  "connectionstring",
  "databaseurl",
  "mongodburi",
]);

const allowedMetadataKeys: Record<SecurityEventType, readonly string[]> = {
  "account.provisioned": ["accountType", "membershipCount", "idempotentReplay"],
  "credential.created": ["algorithm", "mustChangePassword"],
  "account.suspended": ["reason"],
  "account.restored": ["reason"],
  "login.succeeded": ["credentialAlgorithm"],
  "login.failed": ["reason"],
  "password.changed": ["sessionsInvalidated"],
  "password.forced_change_completed": ["sessionsInvalidated"],
  "profile.changed": ["changedFields"],
  "password.legacy_migrated": ["fromAlgorithm", "toAlgorithm", "legacyCost"],
  "session.created": ["sessionId"],
  "session.rotated": ["sessionId"],
  "session.revoked": ["sessionId", "reason"],
  "session.all_revoked": ["reason", "revokedCount"],
  "session.other_sessions_revoked": ["reason", "revokedCount"],
  "membership.granted": ["status"],
  "membership.revoked": ["previousStatus"],
  "admin.operation": ["operation", "reason"],
  "provisioning.conflict": ["reason"],
  "rate_limit.triggered": ["namespace", "retryAfterSeconds"],
};

export function assertSafeEventMetadata(
  metadata: Readonly<Record<string, unknown>>,
  type?: SecurityEventType,
): void {
  const allowed = type ? new Set(allowedMetadataKeys[type]) : null;
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if ((allowed && !allowed.has(key)) || forbiddenMetadataKeys.has(normalizedKey) || (value !== null && typeof value === "object")) {
      throw new Error(`Unsafe security event metadata key: ${key}`);
    }
    if (typeof value === "string" && value.length > 500) throw new Error(`Security event metadata value is too long: ${key}`);
  }
}

export function defineSecurityEventMetadata<T extends SecurityEventType>(
  type: T,
  metadata: SecurityEventMetadataByType[T],
): SecurityEventMetadataByType[T] {
  assertSafeEventMetadata(metadata, type);
  return metadata;
}
