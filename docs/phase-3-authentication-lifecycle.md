# Phase 3 authentication lifecycle

Status: implemented · 2026-09-19

## Dedicated Identity database preflight

Before Phase 3 development, the local untracked Identity configuration was verified as ignored and absent from Git history. Its redacted URI selected `hubzero_identity`; the runtime no longer permits a separate database setting to disagree with the database named by the URI. An authenticated connection confirmed replica-set sessions and a majority/snapshot transaction. The check committed one document in a uniquely named temporary collection inside `hubzero_identity`, deleted it, dropped the collection, and verified removal. No Identity indexes were applied, no Identity account/application/session was created, and no legacy `hubzero` collection was accessed.

The supplied local file intentionally provides only the database URI, which is sufficient for this preflight but not for operating authentication. A real development or deployment runtime must additionally provide its explicit environment name, issuer URL, and independent 32-byte session/rate-limit HMAC keys as described in `.env.example`; the application fails closed if those values are absent. They were not added to the untracked file by this phase.

## Sign-in and account guards

`/sign-in` uses the Phase 2 credential, session, rate-limit, and security-event services. It never reads a password hash in a component or persists a plaintext password. Unknown accounts and absent credentials perform one valid dummy Argon2id verification before returning the same public error as a mismatch. Normal credential failure is not a durable security event: attackers must not be able to create unbounded permanent audit records. Successful sign-in, post-proof suspension denial, and rate-limit threshold events remain auditable.

Login consumes three HMAC-keyed MongoDB buckets: normalized identifier (10 per 15 minutes), privacy-preserving network prefix (60 per 15 minutes), and their combination (15 per 15 minutes). Authentication limiter failures fail closed with a generic temporary-unavailable result. A rate-limit event is recorded once per window in ordinary sequential traffic rather than for every denied request; a concurrent threshold burst may produce a small number of duplicate events, which is preferable to attacker-controlled sustained event volume.

The account resolver is the only server-side cookie/session reader used by account pages. It validates account status, session version, expiry, revocation, and credential `mustChangePassword`. Unauthenticated requests redirect only to a validated relative return path. Authenticated visitors to `/sign-in` return to Account. A password-change-required account may only use `/change-password` or sign out; ordinary Account routes enforce the gate server-side.

## Cookie and session behavior

Production uses `__Host-hz_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no Domain attribute. Products cannot receive or read this cookie. Development and test use the deliberately separate non-secure `hz_session_dev` name only because local HTTP cannot set a `__Host-` cookie; this never changes production semantics.

Session reads defer rotation because Server Components cannot set cookies. A rotation-eligible Account render mounts a tiny same-origin refresh boundary which calls the internal POST-only refresh route. The server route invokes the Phase 2 rotation primitive and sets the replacement HttpOnly cookie; no raw bearer material enters React state. `lastSeenAt` is updated at most once every five minutes to avoid write amplification while keeping idle expiry conservative.

Sign out revokes the current server session and clears the cookie. Revoking another session confirms ownership first and uses its non-secret session ID. “Sign out other sessions” transactionally revokes every old row, increments account session version, creates one fresh current session, and replaces the current cookie.

## Password and profile lifecycle

Password change always requires the current password, including the forced-change flow. The transactional change operation writes Argon2id credentials, clears `mustChangePassword`, invalidates all old bearer material, creates a new current session, and appends all required security events. The current browser remains signed in with the fresh credential; other browsers are signed out.

Profile editing is limited to display name. Email is read-only: an email change needs a verified delivery and anti-takeover flow, which remains deferred. Meaningful name changes are audited.

## Browser security

Server Actions validate the exact configured issuer origin before mutations. Next’s native Server Action protections remain enabled; this explicit validation makes the expected origin policy auditable. The application does not derive trust from arbitrary forwarded hosts. Production requests must use the configured canonical Host.

`proxy.ts` adds production CSP nonce policy and preserves the pre-existing `no-referrer`, `nosniff`, `DENY`, and restrictive permissions headers. There are no third-party scripts, image origins, font origins, or frame allowances. Development-only CSP allowances are documented in ADR 0012.

## Fixtures and tests

Browser tests launch a digest-pinned local MongoDB replica set, create only `@e2e.invalid` fixture accounts and test applications in an isolated random database, start a production-mode local Next server with explicit test-only environment variables, and drop the database/container afterwards. The test command never reads `.env.local` for runtime database configuration and cannot target production data.

Browser coverage includes guard redirects, generic failures, external return rejection, login throttling, forced change gating, voluntary change, current-session replacement, another-session revocation, sign-out-other-sessions, rotation delivery, suspension, and account session invalidation.
