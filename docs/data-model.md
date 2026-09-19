# MongoDB data contract

Identity owns a dedicated database and database credential. Products receive no collection access.

## Collections

- `identity_users`: canonical identity/profile/status/session version. Unique `subject` and `normalizedEmail`.
- `identity_credentials`: one password credential per subject in v1; algorithm and parameters accompany the hash.
- `identity_sessions`: hashed opaque browser sessions, lifecycle timestamps, coarse user-facing device context. TTL on absolute expiry.
- `identity_applications`: registered first-party clients and exact callback URIs. Unique ID, slug, and client ID.
- `identity_memberships`: application-level access only. Unique subject/application pair.
- `identity_authorization_codes`: hashed, single-use protocol artifacts with TTL.
- `identity_refresh_tokens`: hashed rotating artifacts, token-family lineage and TTL.
- `identity_security_events`: append-only durable audit timeline.

The executable index specification is in `src/lib/db/indexes.ts`. Index creation is an idempotent deployment/migration step, not an application-start side effect in a multi-instance production deployment.

## Normalization and concurrency

Email normalization trims surrounding whitespace and applies an explicitly versioned canonicalization rule: Unicode normalization plus domain lowercase and conservative local-part handling. Provider-specific dot/plus rewriting is forbidden. A database unique index is the final arbiter. Changes use compare-and-set/version checks where race-sensitive. Multi-document provisioning uses a MongoDB transaction: user, credential, memberships, and audit event either commit together or reconcile through an idempotency key.

Protocol single-use operations use atomic conditional updates. TTL deletion is cleanup, never the only expiry check; every read enforces `expiresAt`.

## Deliberate omissions

No tenant, organization, arbitrary attribute bag, product role, product preferences, consent-as-membership conflation, or embedded session array exists in the user document.
