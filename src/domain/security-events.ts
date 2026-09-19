import type { ApplicationId } from "./applications";
import type { IdentitySubject } from "./identity";

export const securityEventTypes = [
  "account.provisioned",
  "account.suspended",
  "account.restored",
  "login.succeeded",
  "login.failed",
  "password.changed",
  "password.legacy_migrated",
  "session.created",
  "session.revoked",
  "session.all_revoked",
  "membership.granted",
  "membership.revoked",
  "admin.operation",
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

const forbiddenMetadataKey = /(password|hash|secret|token|code|connection|string|authorization)/i;

export function assertSafeEventMetadata(
  metadata: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (forbiddenMetadataKey.test(key) || typeof value === "object") {
      throw new Error(`Unsafe security event metadata key: ${key}`);
    }
  }
}
