import type { ObjectId } from "mongodb";
import type { AccountStatus, AccountType, IdentitySubject } from "@/domain/identity";
import type { ApplicationId, ApplicationVisibility, ClientType, MembershipStatus } from "@/domain/applications";
import type { PasswordAlgorithm } from "@/domain/credentials";
import type { SecurityEventType } from "@/domain/security-events";

export interface IdentityUserDocument {
  _id: ObjectId;
  subject: IdentitySubject;
  normalizedEmail: string;
  emailNormalizationVersion: number;
  email: string;
  emailVerifiedAt: Date | null;
  name: string;
  imageUrl: string | null;
  accountType: AccountType;
  status: AccountStatus;
  sessionVersion: number;
  provisioning: {
    idempotencyKeyHash: string;
    inputFingerprint: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface PasswordCredentialDocument {
  _id: ObjectId;
  id: string;
  identitySubject: IdentitySubject;
  type: "password";
  passwordHash: string;
  algorithm: PasswordAlgorithm;
  algorithmParameters: Record<string, string | number>;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentitySessionDocument {
  _id: ObjectId;
  id: string;
  identitySubject: IdentitySubject;
  currentSecretHash: string;
  previousSecretHash: string | null;
  previousSecretValidUntil: Date | null;
  secretHashVersion: number;
  sessionVersion: number;
  authenticatedAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  userAgentSummary: string | null;
  ipPrefix: string | null;
}

export interface MembershipDocument {
  _id: ObjectId;
  identitySubject: IdentitySubject;
  applicationId: ApplicationId;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationDocument {
  _id: ObjectId;
  id: ApplicationId;
  slug: string;
  displayName: string;
  description: string;
  clientId: string;
  clientType: ClientType;
  clientSecretReference: string | null;
  visibility: ApplicationVisibility;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  firstParty: boolean;
  enabled: boolean;
  brand: { homeUrl: string; mark?: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface SecurityEventDocument {
  _id: ObjectId;
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
  metadata: Record<string, string | number | boolean | null>;
}

export interface RateLimitDocument {
  _id: string;
  namespace: string;
  count: number;
  windowStartedAt: Date;
  expiresAt: Date;
  lastTriggeredAt?: Date | null;
  updatedAt: Date;
}

/** Provider-owned persistence. It is intentionally separate from canonical Identity records. */
export interface OidcArtifactDocument {
  _id: string;
  model: string;
  payload: Record<string, unknown>;
  expiresAt: Date | null;
  consumedAt: Date | null;
  // Secondary selectors are omitted rather than stored as null so MongoDB's
  // sparse unique indexes truly exclude artifacts that do not expose one.
  uidLookup?: string;
  userCodeLookup?: string;
  grantLookup?: string;
}

/** Opaque bridge between provider-native interactions and the Next.js interaction UI. */
export interface OidcInteractionContinuationDocument {
  _id: string;
  interactionUid: string;
  clientId: string;
  expiresAt: Date;
  createdAt: Date;
}
