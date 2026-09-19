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

## Logging and observability

Application logs are structured and carry timestamp, level, event name, request ID, route template, status, latency, environment, and coarse error code. Metrics cover success/failure counts, rate-limit decisions, protocol error classes, session revocations, and latency. Security events are durable business audit records and do not replace operational logs.

Never log passwords, password hashes, cookie contents, authorization codes, access/refresh/ID tokens, session secrets, private keys, connection strings, raw request bodies, or unredacted query strings on protocol routes. Email and IP are minimized or transformed in operational telemetry.

## Security events

Events are append-only through normal application permissions and contain type, time, outcome, actor and target subjects where relevant, application, request ID, coarse IP prefix, stable reason code, and an allow-listed scalar metadata map. Index by time, subject/time, and type/time. Keep security events online for 400 days initially, subject to legal/operational review; archival or deletion is an explicit operator process rather than TTL in v1. Failed-login volume may later move to a summarized/partitioned stream if scale justifies it.

## Production gates

- TLS and trusted proxy configuration verified end to end
- CSP, HSTS, Referrer-Policy, frame protection, and MIME sniffing headers tested
- key rotation and session-secret rotation runbooks exercised
- backups, restore, MongoDB roles, encryption at rest, and network controls verified
- distributed limiter fail behavior decided and tested
- dependency scan, SAST, protocol conformance, and focused penetration test completed
- incident response owner and account-recovery identity proofing established
