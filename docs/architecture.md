# HubZero Identity architecture

Status: Phase 1 baseline · 2026-09-19

## Boundary

HubZero Identity answers **who is this person?** HubZero Studio and HubZero Fitness answer **may this subject use this product, and what may they do?**

Identity issues an immutable opaque subject (`sub`) and current identity claims. Account type describes the account; it grants nothing. Every product requires an explicit active membership. Studio additionally resolves its current role and capabilities from Studio-owned data on every authorization-sensitive request. A successful login followed by missing membership produces an authorization denial, not an authentication failure.

Products must not read Identity collections, share cookies, receive password hashes, copy sessions, or identify people by email. Their integration surface is OIDC plus narrowly defined back-channel/user-facing contracts.

## Deployment shape

One Node.js deployable owns the Next.js App Router UI and identity domain modules. MongoDB is the durable store. Phase 4 selected a small custom Node entry (`server.ts`) that mounts maintained `oidc-provider` and delegates all non-protocol requests to Next. This preserves one canonical origin and release lifecycle while accepting the documented custom-server trade-off that Next standalone tracing and some automatic static optimization are unavailable. A separate provider process behind trusted deployment routing remains a future operational option; OAuth/OIDC is never hand-rolled.

There is no Edge runtime for password, session, MongoDB, or provider code.

## Domain model

### Account

`IdentityUser.subject` is a generated `hz_`-prefixed ULID. It is immutable, never reused, not derived from email, and becomes OIDC `sub`. Email has both presentation and normalized forms; a unique index enforces normalized-email ownership. `emailVerifiedAt` carries more information than a Boolean. `sessionVersion` provides constant-time global invalidation. Suspension prevents new authentication, token exchange/refresh, and use of existing Identity sessions.

Phase 2 implements email normalization version 1 as trim, NFC normalization, and lowercase of an ASCII address. It deliberately does not rewrite dots, plus tags, or provider aliases. Internationalized addresses require a new normalization version and collision analysis; an implementation change may never silently re-canonicalize existing accounts.

### Application

Applications have immutable IDs and public client identifiers, explicit exact redirect/post-logout URI arrays, client type, first-party flag, visibility, enabled state, and small UI branding metadata. Dynamic registration, arbitrary custom claims, per-client themes, tenants, and organizations are excluded.

Client secrets are credentials, not application document fields exposed to normal reads. They will be hashed where verification permits or held in a versioned secret store. Public native clients have no secret and must use PKCE.

### Membership and authorization

Identity owns a binary/status-bearing application membership: active or disabled. It does not own Studio roles. Studio owns `headAdmin`, `admin`, `member`, capability derivation, and the mapping from Identity subject to legacy Studio ObjectId. Fitness owns Fitness authorization and all Fitness data.

Identity may display role information only through a product-owned, purpose-specific read contract. OAuth consent/grant state and product membership are separate: revoking a token grant does not delete membership; revoking membership does not silently claim to revoke an unrelated grant, though the product must immediately deny access.

### Credentials

Credentials are separate records so password, passkey, MFA, recovery code, and external-provider methods can be added without changing the account identity. V1 implements only password credentials. New/changed passwords use Argon2id (19 MiB, 2 iterations, parallelism 1 as a deployment floor; benchmark before release). Existing bcrypt cost-12 hashes import verbatim with algorithm metadata and are verified with bcrypt's 72-byte behavior clearly isolated. After a successful legacy verification, Identity hashes the supplied password with Argon2id and atomically replaces the bcrypt record; plaintext never persists.

The password policy is 12 Unicode characters minimum, 1024 UTF-8 bytes maximum, no composition or periodic-change rule, and compromised-password screening once a privacy-preserving provider or local corpus is selected. Passwords are compared only through vetted library verification functions; surrounding identifiers and derived lookup values use timing-safe comparison where applicable. `mustChangePassword` survives migration and gates authorization completion until changed.

### Sessions and protocol artifacts

The browser Identity session is an opaque, high-entropy cookie. Only its keyed hash is stored. It is HttpOnly, Secure in non-local environments, `SameSite=Lax`, path `/`, and uses a `__Host-` name in production. Creation always rotates any pre-authentication identifier. Default policy: 7-day idle, 30-day absolute lifetime, rotate at least daily and after privilege/security changes.

The implemented token is `ses_<ULID>.<32 random bytes encoded base64url>`. The ID is non-secret and supports administration; the bearer portion is never persisted. A domain-separated HMAC-SHA-256 lookup value is stored. Daily rotation atomically replaces the current hash and accepts the immediately previous hash for two minutes so parallel browser requests do not randomly sign the user out. Only the winning rotation response receives the new bearer value. Revocation, expiration, version mismatch, and suspension override both hashes.

An authorization code is single-use, short-lived (60 seconds), audience/client/redirect-bound, PKCE-bound, and stored through the provider adapter. Phase 4 access tokens are opaque and five minutes long; refresh tokens are intentionally disabled until a product demonstrates a need. A product establishes its own server-controlled session after callback and re-checks current membership/role for authorization. It must not treat ID-token claims as permanent authorization state.

Session invalidation combines per-session `revokedAt`, account `sessionVersion`, account status, expiration, and (where applicable) membership checks. Sign out everywhere increments the version and revokes current rows. Password reset/change defaults to invalidating other sessions. Signing out of Identity does not falsely promise universal product logout; OIDC logout/back-channel logout support will be explicit per client.

Suspension both increments `sessionVersion` and transactionally revokes active session rows. Restoration increments the version again and never clears revocation, so old sessions cannot resurrect. A validation that linearizes before a revocation/suspension transaction may finish; every validation initiated after the transaction commits fails.

## Protocol contract

Issuer: `https://auth.hubzero.in` in production.

Required endpoints (final paths follow provider defaults unless ADR amendment is required):

- `/.well-known/openid-configuration` — discovery
- `/.well-known/oauth-authorization-server` — authorization metadata
- `/authorize` — Authorization Code only; PKCE S256 required
- `/token` — code and refresh-token exchange
- `/jwks` — current and overlapping public signing keys
- `/userinfo` — minimal scopes only
- `/token/revocation` — supported where client authentication is appropriate
- `/session/end` — RP-initiated logout with exact post-logout URI validation

Baseline scopes are `openid`, `profile`, and `email`. ID-token/userinfo claims are `iss`, `sub`, `aud`, `iat`, `exp`, optional `auth_time`, `nonce`, `name`, `picture`, `email`, and `email_verified`. `accountType`, membership, Studio role, and disabled state are not durable authorization claims in general-purpose tokens.

Confidential web clients authenticate at token endpoints. Authorization requests require state and nonce at the client and S256 PKCE at Identity. Redirect matching is exact; production wildcards and pattern matching are forbidden. Only HTTPS production URIs are allowed. Loopback HTTP is permitted for registered local development callbacks.

### Phase 4 provider override

The Phase 4 provider currently enables only discovery, JWKS, Authorization Code, and token exchange. Authorization Code is the only grant and S256 PKCE is mandatory. Access tokens are opaque with a five-minute lifetime; refresh tokens, UserInfo, revocation, dynamic registration, and RP-initiated logout are disabled. The provider's canonical production issuer remains `https://auth.hubzero.in`; test issuers are explicit and isolated. See ADR 0014 for the rationale and deferred protocol surface.

## Environments

Localhost, preview/staging, and production use different issuers, databases, signing keys, cookie namespaces where required, and explicit client records. Preview callbacks are registered exactly; no wildcard hostnames. Production secrets come from the deployment secret manager and are validated before serving traffic. Development conveniences may never silently weaken production settings.

## Ownership map

| Concern | Identity | Studio | Fitness |
|---|---|---|---|
| Person subject/profile/status | Owns | References `sub` | References `sub` |
| Password/session at issuer | Owns | Never reads | Never reads |
| Product membership | Canonical application-level record | Enforces | Enforces |
| Product roles/capabilities | Does not own | Owns and evaluates | Owns if introduced |
| Legacy ObjectId mapping | Subject half of contract | Owns mapping and ObjectId | N/A |
| Product data | None | Owns CMS data | Owns workouts/history/preferences |

## Repository boundaries

Protocol/domain logic lives under `src/domain` and `src/lib`, never in React components. `src/app` composes server-rendered product surfaces. Database access is collection-specific and direct; no generic repository abstraction is introduced without a concrete need. Phase 3 replaces the Phase 1 Account and sign-in fixtures with server-side Identity data; Studio authorization examples remain representative until Phase 4.

## Phase 3 account lifecycle

The Account UI now resolves a narrow server-side session context from the Identity cookie. It does not expose raw bearer material to components. Account routes redirect unauthenticated visitors to `/sign-in` with a validated relative return path. `mustChangePassword` is an enforced route gate, not a navigation convention. Sign-in, profile changes, password changes, session revocation, and logout call domain services; components and Server Actions do not reproduce Phase 2 credential/session logic.

Server Component validation defers session rotation. A dedicated same-origin internal route performs the Phase 2 rotation and writes the replacement HttpOnly cookie because Server Components cannot mutate cookies while rendering. This route is not a product integration or OAuth/OIDC endpoint.
