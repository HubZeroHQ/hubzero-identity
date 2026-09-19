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
- `identity_rate_limits`: HMAC-keyed, atomically updated fixed-window buckets with TTL cleanup.

The executable index manifest is in `src/lib/db/indexes.ts`. `npm run db:indexes` performs a full preflight, compares keys and security-relevant options by explicit name, fails before creating anything when a conflict exists, and creates only missing indexes. It never drops/replaces an index and does not run at application startup. Index changes are reviewed migration commits applied before compatible application code.

## Normalization and concurrency

Email normalization v1 trims surrounding whitespace, applies NFC, requires an ASCII syntactically valid address, and lowercases the entire address. Provider-specific dot/plus rewriting is forbidden. A database unique index is the final arbiter. Changes use compare-and-set/version checks where race-sensitive. Multi-document provisioning uses a MongoDB transaction: user, credential, memberships, and audit events either commit together or nothing does. A hashed idempotency key and non-secret input fingerprint support safe replay.

Protocol single-use operations use atomic conditional updates. TTL deletion is cleanup, never the only expiry check; every read enforces `expiresAt`.

Transactions are required for provisioning, session creation/revocation/rotation audit, global invalidation, suspension, restoration, and bcrypt migration audit. Unique indexes linearize account/email creation. Credential replacement uses compare-and-set on algorithm and old hash. Session validation uses a final conditional update so committed revocation/version changes win. Rate limits use a single-document aggregation-pipeline update; TTL is cleanup only.

## Deliberate omissions

No tenant, organization, arbitrary attribute bag, product role, product preferences, consent-as-membership conflation, or embedded session array exists in the user document.
