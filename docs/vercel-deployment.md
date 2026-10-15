# Vercel deployment contract

Status: Vercel selected as the primary deployment target. A secret-backed,
isolated runtime rehearsal now proves canonical-domain readiness, discovery,
JWKS, real synthetic Argon2 sign-in, Authorization Code + PKCE exchange, and
one-time authorization-code rejection. Broader operational exercises remain
explicit post-Phase-7 hardening work.

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
preview. An isolated protocol test deployment uses `APP_ENV=staging` instead,
with its own explicit issuer, clients, secrets, and database, never an arbitrary
preview hostname.

### Isolated OIDC test issuer (`APP_ENV=staging`)

`staging` is production-grade everywhere `production` is: an HTTPS issuer;
required `SESSION_HMAC_KEY_BASE64` and `RATE_LIMIT_HMAC_KEY_BASE64`; every HMAC
key at least 32 bytes; `__Host-` cookie names; Secure cookies; and canonical
`Host` enforcement in Proxy and the Node bridge. It differs in exactly two ways,
both enforced by environment validation:

- the issuer host must **not** be `auth.hubzero.in`;
- the database must be exactly `hubzero_identity_staging`, so neither the
  production Identity database (`hubzero_identity`) nor Studio's (`hubzero`)
  can be selected.

Every secret (signing keyset and active `kid`, HMAC keys, client secrets) is
generated for staging alone; none is copied from production.

The dedicated Studio test client is registered with
`scripts/register-staging-studio-client.ts`. It reads only
`IDENTITY_STAGING_MONGODB_URI`, refuses any database but
`hubzero_identity_staging`, and refuses to write unless the credential holds
exactly `readWrite@hubzero_identity_staging`. It also refuses:

- the production issuer host;
- the production client `hubzero-studio`;
- the production secret reference `studio-production`;
- a `hubzero.in` or `www.hubzero.in` callback;
- any callback other than `https://<host>/studio/oidc/callback`.

Creating the staging deployment, its DNS name, database, keys, and client is an
operator action that needs separate authorization.

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

The isolated rehearsal uses only `hubzero_identity_rehearsal`, test-only key
material, a synthetic application/membership, and synthetic identities. Its
database preflight accepted exactly `readWrite@hubzero_identity_rehearsal`.
The deployed Node 22 Function returned live `204`, readiness `200`, HTTPS
discovery with the explicit rehearsal issuer, and a public-only ES256 JWKS.
An actual browser checked generic bad-password handling plus a successful
synthetic Argon2 sign-in and HttpOnly server-side session lookup.

The initial runtime defect was a missing native-password closure: Vercel's
function trace omitted `argon2` transitive runtime files and Next rejected a
variable dynamic import. Credential routes now explicitly trace the narrow
`argon2`/`bcrypt` closure; readiness contains that closure and validates it;
metadata routes do not eagerly load it. A build assertion checks the final
function artifacts, and the native loader uses Node `createRequire` from the
function root. No password semantics changed.

Vercel has verified `auth.hubzero.in` on the correct project. Cloudflare
continues to provide authoritative DNS, with only Vercel's requested DNS-only
subdomain CNAME; no nameserver change or Cloudflare proxy is required. The
healthy isolated rehearsal deployment was aliased to the canonical host and
returned live `204`, ready `200`, canonical discovery metadata, and canonical
JWKS. The browser verifier asserts that a retained `__Host-hz_session` has
Secure, HttpOnly, SameSite=Lax, Path=/, and host-only semantics.

The proof uses fresh rehearsal secrets and only `hubzero_identity_rehearsal`.
No production secret, client, account, credential, membership, mapping, or
OIDC artifact was configured or created.

## Rollback procedure and deferred hardening

For Phase 7, the deployment rollback procedure is: select the last verified
Vercel deployment in the project, promote it through the Vercel Deployments UI
or `vercel promote <deployment> --scope rifaques-projects`, then verify
`/health/live`, `/health/ready`, discovery, JWKS, and sign-in. Deployment
rollback does not roll back Identity or Studio data and must not be used as a
migration rollback substitute.

The following exercises remain post-Phase-7 operational hardening: concurrent
code-consumption stress, exhaustive cross-instance artifact persistence, live
A-to-B signing-key rotation, live Vercel rollback exercise, and the exhaustive
callback-negative browser matrix. Their existing protections/tests remain in
place; this document does not claim that those live exercises occurred.

Historical next-rehearsal checklist (superseded for Phase 6B exit):

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

The historical checklist does not authorize any production Identity collection
initialization, client registration, account provisioning, or Studio cutover.
