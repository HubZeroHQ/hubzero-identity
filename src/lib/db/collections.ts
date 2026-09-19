import type { Collection, Db } from "mongodb";
import type {
  ApplicationDocument,
  IdentitySessionDocument,
  IdentityUserDocument,
  MembershipDocument,
  PasswordCredentialDocument,
  RateLimitDocument,
  SecurityEventDocument,
  OidcArtifactDocument,
  OidcInteractionContinuationDocument,
} from "./documents";

export function identityUsersCollection(database: Db): Collection<IdentityUserDocument> {
  return database.collection<IdentityUserDocument>("identity_users");
}

export function identityCredentialsCollection(database: Db): Collection<PasswordCredentialDocument> {
  return database.collection<PasswordCredentialDocument>("identity_credentials");
}

export function identitySessionsCollection(database: Db): Collection<IdentitySessionDocument> {
  return database.collection<IdentitySessionDocument>("identity_sessions");
}

export function identityApplicationsCollection(database: Db): Collection<ApplicationDocument> {
  return database.collection<ApplicationDocument>("identity_applications");
}

export function identityMembershipsCollection(database: Db): Collection<MembershipDocument> {
  return database.collection<MembershipDocument>("identity_memberships");
}

export function identitySecurityEventsCollection(database: Db): Collection<SecurityEventDocument> {
  return database.collection<SecurityEventDocument>("identity_security_events");
}

export function identityRateLimitsCollection(database: Db): Collection<RateLimitDocument> {
  return database.collection<RateLimitDocument>("identity_rate_limits");
}

const oidcModels = new Set([
  "AccessToken", "AuthorizationCode", "Grant", "Interaction", "Session",
]);

/** Only the provider adapter may access these names; callers cannot choose an arbitrary collection. */
export function oidcProviderArtifactsCollection(database: Db, model: string): Collection<OidcArtifactDocument> {
  if (!oidcModels.has(model)) throw new Error(`Unsupported OIDC provider artifact model: ${model}`);
  return database.collection<OidcArtifactDocument>(`oidc_${model.toLowerCase()}_artifacts`);
}

export function oidcInteractionContinuationsCollection(database: Db): Collection<OidcInteractionContinuationDocument> {
  return database.collection<OidcInteractionContinuationDocument>("oidc_interaction_continuations");
}
