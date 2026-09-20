# Security baseline and threat model

## Primary risks and controls

| Risk | Baseline control |
|---|---|
| Brute force / credential stuffing | Layered rate limits by normalized account key and privacy-preserving IP prefix, escalating delay, generic response, security event; no permanent attacker-triggered lockout |
| Account enumeration | Same public copy/status shape for unknown account, wrong password, and unavailable credential; bounded timing; recovery also responds generically |
| Password database theft | Argon2id, unique salts, optional secret-manager pepper only after rotation design; legacy bcrypt upgraded after success |
| Session fixation/theft | New identifier after authentication, hashed server-side secret, Secure HttpOnly host cookie, rotation, idle/absolute expiry, revocation and session-version checks |
| CSRF | SameSite cookie plus synchronizer/origin validation for mutations; OAuth state remains a client responsibility; no state-changing GET routes |
| XSS | Server rendering by default, strict CSP designed before interactive auth work, no token storage in browser JS, output encoding, dependency review |
| Open redirect | Exact registered URI match and allow-listed local exceptions; return destinations represented by signed/validated protocol state |
| Code/token replay | One-time atomic code consumption, PKCE S256, audience/client/redirect binding, hashed artifacts, short TTL; refresh rotation with family reuse detection |
| Stale authorization | Product checks membership and current role server-side; short product-session authorization cache with invalidation path; no role in durable Identity session claims |
| Privilege escalation | Explicit admin permission, re-authentication for sensitive actions, server-side enforcement, actor/target audit, no `accountType` grant |
| Secret/key compromise | Versioned keys, overlapping public JWKS during rotation, secret-manager delivery, documented emergency rotation and token lifetime bounds |
| Sensitive telemetry | Central redaction and allow-listed audit metadata; request correlation IDs never contain identity/token material |

## Rate-limit strategy

Use a shared atomic store in multi-instance environments. Separate buckets apply to login account key, IP prefix, recovery account key, token endpoint client/IP, and administrative mutations. Responses are generic and use `Retry-After` where appropriate. Successful login resets only the account-specific failure progression after an event is recorded. Limits and thresholds are deployment configuration with conservative defaults; production cannot start with the limiter disabled. A CAPTCHA is not a v1 default.

Phase 2 uses MongoDB fixed-window buckets. Raw identifiers are converted to namespace-separated HMAC-SHA-256 bucket IDs; only the namespace is readable. An atomic update caps count at `limit + 1`, returns retry-after, and prevents lost updates. TTL removes expired buckets but the update checks expiry itself. Callers must choose `fail_closed` (authentication, credential, recovery and protocol abuse) or a documented `fail_open` policy for non-security availability controls. MongoDB is sufficient for current private scale; replace the narrow `RateLimiter` interface with Redis or another atomic store if write load or latency demonstrates a need.

## Logging and observability

Application logs are structured and carry timestamp, level, event name, request ID, route template, status, latency, environment, and coarse error code. Metrics cover success/failure counts, rate-limit decisions, protocol error classes, session revocations, and latency. Security events are durable business audit records and do not replace operational logs.

Never log passwords, password hashes, cookie contents, authorization codes, access/refresh/ID tokens, session secrets, private keys, connection strings, raw request bodies, or unredacted query strings on protocol routes. Email and IP are minimized or transformed in operational telemetry.

## Security events

Events are append-only through normal application permissions and contain type, time, outcome, actor and target subjects where relevant, application, request ID, coarse IP prefix, stable reason code, and an allow-listed scalar metadata map. Index by time, subject/time, and type/time. Keep security events online for 400 days initially, subject to legal/operational review; archival or deletion is an explicit operator process rather than TTL in v1. Failed-login volume may later move to a summarized/partitioned stream if scale justifies it.

Metadata is typed per event and runtime-rejects objects plus known secret-bearing keys. Provisioning, credential creation/upgrade, session create/rotate/revoke, global invalidation, suspension, and restoration write their audit record inside the same MongoDB transaction as the state change. Audit failure aborts those operations. Rate-limit denial audit failure is surfaced as storage failure and handled by the caller's explicit failure policy; it is never silently treated as an allowance.

## Production gates

- TLS and trusted proxy configuration verified end to end
- CSP, HSTS, Referrer-Policy, frame protection, and MIME sniffing headers tested
- key rotation and session-secret rotation runbooks exercised
- backups, restore, MongoDB roles, encryption at rest, and network controls verified
- distributed limiter fail behavior decided and tested
- dependency scan, SAST, protocol conformance, and focused penetration test completed
- incident response owner and account-recovery identity proofing established

## Phase 3 browser controls

Sign-in uses generic public failure copy for unknown email, absent credential, and mismatch. Unknown-email paths do one valid dummy Argon2id verification to avoid a gross timing split without introducing a per-request hash generation cost. Normal failed credentials are not durable audit events; durable success, post-proof unavailable-account, session, password, profile, and throttling events are constrained typed records.

All state-changing account Server Actions validate the exact `IDENTITY_ISSUER_URL` origin. Safe return paths are Identity-relative only; OAuth client redirect semantics are explicitly deferred. Production cookies use the host-only `__Host-hz_session` contract. A nonce CSP from `proxy.ts` blocks framing, objects, third-party connections, and untrusted scripts/styles in production; Next development allowances are limited to development.

## Phase 4 protocol controls

The provider uses a custom Node entry with `oidc-provider`, exact registered redirect URIs, confidential-client Basic authentication, and mandatory PKCE S256. Existing Identity sessions are the only browser authentication authority; an interaction continuation is HMAC-indexed and short-lived. Test clients validate state and nonce, while Identity enforces active account/application/membership before issuing a code. Provider artifacts are persisted in the dedicated database and authorization-code consumption is a conditional update. Opaque access tokens expire after five minutes; refresh tokens, UserInfo, revocation, and RP-initiated logout are intentionally disabled. Private ES256 signing keys are supplied through deployment configuration and never logged or exposed by JWKS. `OIDC_SIGNING_ACTIVE_KID` makes the active key deterministic; retired keys are public-only during verification overlap.
