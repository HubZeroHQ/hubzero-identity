import type { Db, IndexDescription, IndexDescriptionInfo } from "mongodb";

export interface CollectionIndexManifest {
  collection: string;
  indexes: readonly IndexDescription[];
}

export const identityIndexManifest: readonly CollectionIndexManifest[] = [
  { collection: "identity_users", indexes: [
    { key: { subject: 1 }, name: "uniq_subject", unique: true },
    { key: { normalizedEmail: 1 }, name: "uniq_normalized_email", unique: true },
    { key: { "provisioning.idempotencyKeyHash": 1 }, name: "uniq_provisioning_key", unique: true, sparse: true },
    { key: { status: 1 }, name: "by_status" },
  ] },
  { collection: "identity_credentials", indexes: [
    { key: { id: 1 }, name: "uniq_credential_id", unique: true },
    { key: { identitySubject: 1, type: 1 }, name: "uniq_subject_credential_type", unique: true },
  ] },
  { collection: "identity_sessions", indexes: [
    { key: { id: 1 }, name: "uniq_session_id", unique: true },
    { key: { identitySubject: 1, revokedAt: 1 }, name: "subject_active_sessions" },
    { key: { absoluteExpiresAt: 1 }, name: "expire_sessions", expireAfterSeconds: 0 },
  ] },
  { collection: "identity_applications", indexes: [
    { key: { id: 1 }, name: "uniq_application_id", unique: true },
    { key: { slug: 1 }, name: "uniq_application_slug", unique: true },
    { key: { clientId: 1 }, name: "uniq_client_id", unique: true },
  ] },
  { collection: "identity_memberships", indexes: [
    { key: { identitySubject: 1, applicationId: 1 }, name: "uniq_subject_application", unique: true },
    { key: { applicationId: 1, status: 1 }, name: "application_active_members" },
  ] },
  { collection: "identity_security_events", indexes: [
    { key: { id: 1 }, name: "uniq_security_event_id", unique: true },
    { key: { occurredAt: -1 }, name: "by_time" },
    { key: { targetSubject: 1, occurredAt: -1 }, name: "subject_timeline" },
    { key: { type: 1, occurredAt: -1 }, name: "event_type_timeline" },
  ] },
  { collection: "identity_rate_limits", indexes: [
    { key: { expiresAt: 1 }, name: "expire_rate_limits", expireAfterSeconds: 0 },
    { key: { namespace: 1, updatedAt: -1 }, name: "namespace_activity" },
  ] },
  { collection: "identity_authorization_codes", indexes: [
    { key: { codeHash: 1 }, name: "uniq_code_hash", unique: true },
    { key: { expiresAt: 1 }, name: "expire_authorization_codes", expireAfterSeconds: 0 },
  ] },
  { collection: "identity_refresh_tokens", indexes: [
    { key: { tokenHash: 1 }, name: "uniq_token_hash", unique: true },
    { key: { familyId: 1 }, name: "refresh_token_family" },
    { key: { expiresAt: 1 }, name: "expire_refresh_tokens", expireAfterSeconds: 0 },
  ] },
  { collection: "oidc_authorizationcode_artifacts", indexes: [
    { key: { expiresAt: 1 }, name: "expire_artifacts", expireAfterSeconds: 0 },
    { key: { grantLookup: 1 }, name: "by_grant", sparse: true },
  ] },
  { collection: "oidc_accesstoken_artifacts", indexes: [
    { key: { expiresAt: 1 }, name: "expire_artifacts", expireAfterSeconds: 0 },
    { key: { grantLookup: 1 }, name: "by_grant", sparse: true },
  ] },
  { collection: "oidc_grant_artifacts", indexes: [
    { key: { expiresAt: 1 }, name: "expire_artifacts", expireAfterSeconds: 0 },
  ] },
  { collection: "oidc_interaction_artifacts", indexes: [
    { key: { expiresAt: 1 }, name: "expire_artifacts", expireAfterSeconds: 0 },
    { key: { uidLookup: 1 }, name: "by_uid", unique: true, sparse: true },
  ] },
  { collection: "oidc_session_artifacts", indexes: [
    { key: { expiresAt: 1 }, name: "expire_artifacts", expireAfterSeconds: 0 },
    { key: { uidLookup: 1 }, name: "by_uid", unique: true, sparse: true },
  ] },
  { collection: "oidc_interaction_continuations", indexes: [
    { key: { expiresAt: 1 }, name: "expire_continuations", expireAfterSeconds: 0 },
    { key: { interactionUid: 1 }, name: "by_interaction_uid" },
  ] },
] as const;

export interface IndexMigrationPlan {
  create: Array<{ collection: string; definition: IndexDescription }>;
  verified: Array<{ collection: string; name: string }>;
}

export class IndexMigrationConflictError extends Error {
  constructor(collection: string, indexName: string, details: string) {
    super(`Index conflict in ${collection}.${indexName}: ${details}. No indexes were changed.`);
    this.name = "IndexMigrationConflictError";
  }
}

function entries(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function sameKey(left: unknown, right: unknown): boolean {
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

function numeric(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) return (value as { toNumber(): number }).toNumber();
  return Number(value);
}

function mismatch(existing: IndexDescriptionInfo, desired: IndexDescription): string | null {
  if (!sameKey(existing.key, desired.key)) return `key is ${JSON.stringify(existing.key)}, expected ${JSON.stringify(desired.key)}`;
  if (Boolean(existing.unique) !== Boolean(desired.unique)) return `unique is ${Boolean(existing.unique)}, expected ${Boolean(desired.unique)}`;
  if (Boolean(existing.sparse) !== Boolean(desired.sparse)) return `sparse is ${Boolean(existing.sparse)}, expected ${Boolean(desired.sparse)}`;
  if (numeric(existing.expireAfterSeconds) !== numeric(desired.expireAfterSeconds)) {
    return `expireAfterSeconds is ${numeric(existing.expireAfterSeconds)}, expected ${numeric(desired.expireAfterSeconds)}`;
  }
  return null;
}

export async function planIdentityIndexes(database: Db): Promise<IndexMigrationPlan> {
  const plan: IndexMigrationPlan = { create: [], verified: [] };
  const existingCollections = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  for (const manifest of identityIndexManifest) {
    const existing = existingCollections.has(manifest.collection)
      ? await database.collection(manifest.collection).listIndexes().toArray()
      : [];
    for (const desired of manifest.indexes) {
      const name = String(desired.name);
      const byName = existing.find((index) => index.name === name);
      if (byName) {
        const details = mismatch(byName, desired);
        if (details) throw new IndexMigrationConflictError(manifest.collection, name, details);
        plan.verified.push({ collection: manifest.collection, name });
        continue;
      }
      const byKey = existing.find((index) => index.name !== "_id_" && sameKey(index.key, desired.key));
      if (byKey) {
        throw new IndexMigrationConflictError(manifest.collection, name, `the same key already exists as ${byKey.name}; explicit index names are required`);
      }
      plan.create.push({ collection: manifest.collection, definition: desired });
    }
  }
  return plan;
}

export async function applyIdentityIndexes(database: Db): Promise<IndexMigrationPlan> {
  const plan = await planIdentityIndexes(database);
  for (const item of plan.create) await database.collection(item.collection).createIndex(item.definition.key, item.definition);
  return plan;
}

export const ensureIdentityIndexes = applyIdentityIndexes;
