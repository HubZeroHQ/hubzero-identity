import type { Db, IndexDescription } from "mongodb";

export const identityIndexes: Readonly<Record<string, readonly IndexDescription[]>> = {
  identity_users: [
    { key: { subject: 1 }, name: "uniq_subject", unique: true },
    { key: { normalizedEmail: 1 }, name: "uniq_normalized_email", unique: true },
    { key: { status: 1 }, name: "by_status" },
  ],
  identity_credentials: [
    { key: { identitySubject: 1, type: 1 }, name: "uniq_subject_credential_type", unique: true },
  ],
  identity_sessions: [
    { key: { id: 1 }, name: "uniq_session_id", unique: true },
    { key: { identitySubject: 1, revokedAt: 1 }, name: "subject_active_sessions" },
    { key: { absoluteExpiresAt: 1 }, name: "expire_sessions", expireAfterSeconds: 0 },
  ],
  identity_applications: [
    { key: { id: 1 }, name: "uniq_application_id", unique: true },
    { key: { slug: 1 }, name: "uniq_application_slug", unique: true },
    { key: { clientId: 1 }, name: "uniq_client_id", unique: true },
  ],
  identity_memberships: [
    { key: { identitySubject: 1, applicationId: 1 }, name: "uniq_subject_application", unique: true },
    { key: { applicationId: 1, status: 1 }, name: "application_active_members" },
  ],
  identity_security_events: [
    { key: { occurredAt: -1 }, name: "by_time" },
    { key: { targetSubject: 1, occurredAt: -1 }, name: "subject_timeline" },
    { key: { type: 1, occurredAt: -1 }, name: "event_type_timeline" },
  ],
  identity_authorization_codes: [
    { key: { codeHash: 1 }, name: "uniq_code_hash", unique: true },
    { key: { expiresAt: 1 }, name: "expire_authorization_codes", expireAfterSeconds: 0 },
  ],
  identity_refresh_tokens: [
    { key: { tokenHash: 1 }, name: "uniq_token_hash", unique: true },
    { key: { familyId: 1 }, name: "refresh_token_family" },
    { key: { expiresAt: 1 }, name: "expire_refresh_tokens", expireAfterSeconds: 0 },
  ],
};

export async function ensureIdentityIndexes(database: Db): Promise<void> {
  for (const [collection, indexes] of Object.entries(identityIndexes)) {
    await database.collection(collection).createIndexes([...indexes]);
  }
}
