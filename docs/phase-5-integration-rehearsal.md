# Phase 5 — first-party integration and migration rehearsal

Status: implementation and rehearsal only · 2026-09-20

## Identity deployment

Identity keeps the accepted custom Node topology: `server.ts` prepares Next.js,
mounts `oidc-provider`, and delegates Account UI, RSC, and static assets to Next.
The new `Dockerfile` is the deployable rehearsal shape. Its build stage compiles
the custom entry with esbuild; the runtime starts that compiled Node artifact,
not a development TypeScript loader. It exposes port 3000, provides liveness at
`/health/live`, and returns OIDC readiness
at `/health/ready` and `/health/oidc`. SIGTERM/SIGINT stop the listener, allow a
bounded ten-second drain, close MongoDB, and exit.

No Identity hosting target is represented in this repository. Phase 6 is blocked
until a target that supports a long-lived Node/Docker process is selected and
rehearsed; Vercel's custom-server-incompatible deployment model is not suitable.
Its TLS proxy must preserve `Host: auth.hubzero.in`, route protocol/UI/static/RSC
paths to the same process, and never let forwarded headers determine the issuer.

## Production configuration inventory

| Value | Purpose | Rotation/failure behavior |
| --- | --- | --- |
| `MONGODB_URI` | dedicated Identity database | least-privilege secret; startup fails closed |
| `SESSION_HMAC_KEY_BASE64` | Identity session lookup HMAC | separate 32+ byte secret; dual-read rotation deferred |
| `RATE_LIMIT_HMAC_KEY_BASE64` | privacy-preserving limiter key | independent 32+ byte secret |
| `OIDC_ADAPTER_HMAC_KEY_BASE64` | provider artifact selectors | separate key; artifacts remain readable through TTL |
| `OIDC_SIGNING_KEYSET_JSON` | ES256 active-private/overlap-public keyset | overlap then restart; absent/invalid fails closed |
| `OIDC_SIGNING_ACTIVE_KID` | selects the one private JWK used for new tokens | non-secret; makes rollover order explicit |
| `OIDC_CLIENT_SECRETS_JSON` | client-secret reference map | rotate each client with coordinated deployment |
| Studio/Fitness client secrets | `client_secret_basic` | server-only, unique per app/environment |
| trusted proxy configuration | canonical host/TLS boundary | review with every proxy change |

All values belong in deployment secret/configuration management, never Git, logs,
browser JavaScript, or a migration artifact.

## Signing key rehearsal

Use non-production ES256 P-256 keys. `OIDC_SIGNING_ACTIVE_KID` must name the
one private signing JWK; provider startup puts that key first for the library's
signer while JWKS retains the remaining public verification keys. Confirm the
token `kid` and public-only JWKS. Add a new private key, set its `kid` active,
confirm new tokens use it while the old public key still verifies issued tokens,
then remove retired private material and finally its public key only after the
five-minute token lifetime, clock tolerance, and rollback window. Production
follows this same secret-manager sequence and records operator, time, and key
IDs. A compromise rotates immediately and follows each product's own session
incident procedure.

## Provider initialization

`npm run db:indexes` plans first, creates only missing indexes, never runs at
startup, and never replaces conflicts. Provider collections are
`oidc_interaction_artifacts`, `oidc_session_artifacts`, `oidc_grant_artifacts`,
`oidc_authorizationcode_artifacts`, `oidc_accesstoken_artifacts`, and
`oidc_interaction_continuations`; their reviewed TTL/lookup indexes are in the
Identity manifest. Production initialization needs an approved dry run. Empty
collections are expected; rollback is application/configuration rollback, never
blind index deletion.

## First-party client contracts

No production application document or secret was inserted in Phase 5.

| Application | stable app / client ID | client policy | production callback |
| --- | --- | --- | --- |
| HubZero Studio | `studio` / `hubzero-studio-web` | confidential web, Basic auth, PKCE S256, `openid profile email` | `https://hubzero.in/studio/oidc/callback` |
| HubZero Fitness | `fitness` / `hubzero-fitness-web` | confidential web, Basic auth, PKCE S256, `openid profile email` | `https://fitness.hubzero.in/oidc/callback` |

Development/staging callbacks are separate explicit registrations.
`gym.hubzero.in` is a redirect only, never a client/callback origin. RP logout is
disabled, so post-logout values are preparatory. The opaque five-minute access
token is unused after sign-in; neither product calls UserInfo. `email_verified`
stays false for administratively migrated accounts until a real verification
policy sets `emailVerifiedAt`.

## Studio relying-party rehearsal

`legacy` remains Studio's default. `dual` keeps legacy credentials active and
enables an isolated OIDC rehearsal path; its login link is separately disabled
unless explicitly configured. `oidc` is reserved for Phase 6 and fails without
issuer, client credentials, callback, and transaction key.

Studio uses `openid-client` 6.8.8 for discovery, Authorization Code with PKCE
S256, state, nonce, Basic client authentication, and issuer/audience/signature/
expiry validation. HTTP is allowed only for explicit local/test issuer settings;
production requires `https://auth.hubzero.in` and HTTPS.

The immutable `sub` maps through additive `users.identitySubject`. Its sparse
unique index preserves a one-to-one mapping while existing `_id` remains the key
for Studio roles, capabilities, content ownership, assignments, and history. The
callback checks disabled and Studio password-change state, then creates a 60-second
one-time HMAC-addressed handoff. An internal Auth.js provider consumes only its
HttpOnly cookie and emits the existing Studio session. Identity tokens/cookies
never become Studio credentials.

`npm run studio:oidc:indexes -- --read-only` only plans mapping/handoff indexes.
It requires an explicit flag, cannot create without separate write acknowledgement,
and refuses production creation in this rehearsal tool. Studio logout destroys a
Studio session only; Identity logout destroys an Identity session only.

## Fitness readiness

No Fitness repository or application foundation exists in the shared workspace.
Phase 5 does not claim Fitness integration or cross-product browser SSO. The
binding implementation contract is Authorization Code + PKCE/state/nonce/token
validation, a unique `(identityIssuer, identitySubject)` Fitness key, and a
Fitness-owned session. Fitness must not copy passwords, query Identity MongoDB,
or use email as durable identity.

## Read-only migration rehearsal

`npm run migration:studio:rehearse -- --input=<sanitized-users.json> --mode=inventory`
opens no database. `--mode dry-run` accepts an explicit membership manifest and
returns no raw hash. It applies Identity normalization v1, detects invalid/colliding
emails, reports only bcrypt version/cost metadata, preserves disabled and
`mustChangePassword` intent, and blocks unsafe records. New subjects are described
as `create_subject_at_apply`; they are never derived/generated by the dry run.

Phase 6 will import valid bcrypt hashes verbatim with parsed metadata; a later
successful login invokes Phase 2's atomic Argon2id upgrade. Plaintext is never
requested/stored. No Studio production inventory ran: the Studio bootstrap warns
that `.env.local` may target a writable real database and no constrained read-only
source connection was supplied. No legacy collection was opened.

## Phase 6 gates

See `docs/phase-6-cutover-runbook.md`. Block Phase 6 until a Node host is selected,
secrets/key rotation are approved, exact clients work in isolated rehearsal, Fitness
exists and proves its callback, a read-only Studio inventory is approved, collisions
and credential exceptions are resolved, and backups, membership manifest, session
invalidation, dry run/resume/reconciliation, and rollback are rehearsed.
