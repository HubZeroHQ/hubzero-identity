# Vercel deployment contract

Status: Vercel selected as the primary deployment target. The project has
successfully built and deployed the adapter, but the canonical domain and a
secret-backed isolated runtime rehearsal remain explicit Phase 6B gates.

## Topology

Vercel is evaluated as the primary deployment target for the one canonical
origin, `https://auth.hubzero.in`:

```text
Browser → Vercel HTTPS edge → Next.js Account routes
                              └→ Node Function → oidc-provider → MongoDB Atlas
```

`vercel.json` rewrites only canonical OIDC, interaction, and health paths to
fixed Node Function adapters under `api/oidc/`. Each adapter reconstructs one
canonical issuer path before calling the Node-native provider bridge. Fixed
functions avoid relying on catch-all routing behavior for protocol artifacts.
No discovery metadata or client registration exposes an `/api/oidc` URL or a
second issuer. `/authorize/interaction` intentionally remains a Next route,
not a rewrite target.

The portable `server.ts` and `dist/server.mjs` remain the development/Docker
fallback. They invoke the same bridge and are not a Vercel entrypoint.

## Runtime and durable state

OIDC runs in the Node.js runtime, not Proxy/Edge. The Next Proxy remains a
small header/host gate; it must never import MongoDB or `oidc-provider`.
MongoDB is authoritative for Identity sessions, session revocation/security
versions, rate-limit buckets, interaction continuations, provider sessions,
grants, authorization codes, and opaque access tokens. The provider adapter
atomically consumes an authorization code with a conditional MongoDB update;
one distributed caller wins and every later caller receives `invalid_grant`.

Mongo clients are module-scoped per warm instance, so requests reuse a client
when an instance is retained. `@vercel/functions` registers the Mongo client
with Fluid Compute pool management. A failed initial connection clears the
cached promise, allowing a later request to reconnect; no correctness depends
on shutdown hooks, a warm instance, or sticky routing.

## Environment contract

Configure these in Vercel's project environment settings, never in Git,
`vercel.json`, or `NEXT_PUBLIC_*` variables:

| Variable | Classification | Required use |
| --- | --- | --- |
| `MONGODB_URI` | production secret | Explicit `hubzero_identity` database only. |
| `MONGODB_DATABASE` | production non-secret | Must match the URI database. |
| `SESSION_HMAC_KEY_BASE64` | production secret | At least 32 bytes decoded. |
| `RATE_LIMIT_HMAC_KEY_BASE64` | production secret | At least 32 bytes decoded. |
| `OIDC_ADAPTER_HMAC_KEY_BASE64` | production secret | At least 32 bytes decoded. |
| `OIDC_SIGNING_KEYSET_JSON` | production secret | Private ES256 JWK set. |
| `OIDC_SIGNING_ACTIVE_KID` | production non-secret | Selects the active private key. |
| `OIDC_CLIENT_SECRETS_JSON` | production secret | Maps Identity-owned references to client secrets. |
| `IDENTITY_ISSUER_URL` | production non-secret | Exactly `https://auth.hubzero.in`. |
| `APP_ENV` | production non-secret | Exactly `production`. |
| `OIDC_PROVIDER_ENABLED` | production non-secret | `true` only after approved initialization. |
| `TRUSTED_PROXIES` | production non-secret | Only documented, trusted forwarding boundary; optional. |

`EMAIL_*` remains development/future recovery configuration and is not required
for the present provider. Docker-only `PORT` is not a Vercel requirement.
`VERCEL_URL` is never used to derive issuer, host trust, redirects, or cookies.

Preview deployments must set `APP_ENV=preview` and leave
`OIDC_PROVIDER_ENABLED=false`; environment validation rejects enabled OIDC on a
preview. A future isolated protocol test deployment needs its own explicit
issuer, clients, secrets, and database, not an arbitrary preview hostname.

## Host, cookies, keys, and health

In production both Proxy and the Node bridge require the configured canonical
`Host`; unexpected hosts receive `421`. The issuer itself is fixed by
configuration, never `Host`, `X-Forwarded-Host`, or `VERCEL_URL`. The Identity
cookie remains `__Host-hz_session`, HttpOnly, Secure, SameSite=Lax, Path `/`,
and has no Domain attribute.

`/health/live` checks only request handling. `/health/ready` and
`/health/oidc` initialize/check enabled provider dependencies without revealing
configuration. A missing MongoDB connection or required OIDC key/configuration
therefore fails readiness; authentication actions continue to fail closed.

For signing-key rotation, deploy keyset `A+B` with `B` selected by
`OIDC_SIGNING_ACTIVE_KID`, then validate that new ID tokens use B while JWKS
publishes A and B public material. Keep A public-only until all A-signed ID
tokens have expired; remove A private material in a later deployment. Changing
Vercel environment variables applies only to a new deployment, so each key
step is a deploy and rollback point.

## Rehearsal evidence and remaining gates

On 2026-09-20, Vercel CLI 59.23.2 deployed the linked project successfully
with Node 22 in `iad1`. The generated protocol functions use `nodejs22.x`; the
standard Next build and explicit rewrites were accepted without a custom
listener. `/health/live` returned `204` through Vercel's authenticated operator
request path. With no configured project environment variables,
`/health/ready` returned `500` without exposing missing-key details. This is
the intended fail-closed result.

The rehearsal did not initialize MongoDB or configure any production secret,
client, signing key, account, or OIDC artifact. Deployment Protection is
enabled, and `auth.hubzero.in` is not yet DNS-verified at Vercel. Those facts
mean the deployment is not a usable Identity provider yet.

## Required next rehearsal

The selected Vercel project must next prove:

1. a Node.js Vercel deployment with the production-equivalent secret contract;
2. canonical custom-domain DNS/TLS and `auth.hubzero.in` discovery/JWKS;
3. Account sign-in/session rotation, OIDC interaction, code exchange, and
   token validation against isolated test data;
4. a redeploy between interaction/session/code operations, proving Mongo
   durability and stable signing configuration;
5. host rejection, readiness failure with missing dependencies, runtime logs,
   and a previous-deployment rollback; and
6. the A→B key-overlap procedure with rehearsal keys.

Until this occurs, Vercel is an approved deployment target but not an approved
Identity production runtime. No production Identity collection initialization,
client registration, account provisioning, or Studio cutover is authorized by
this document.
