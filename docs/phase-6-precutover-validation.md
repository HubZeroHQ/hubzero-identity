# Phase 6 — pre-cutover validation

Status: **NO-GO** · 2026-09-20. This is an evidence record, not a migration
approval. No Studio user, credential, mapping, session, role, CMS reference, or
Identity account was changed while producing it.

Phase 6B reconfirmed these blockers without weakening a control or opening a
Studio collection; see `phase-6b-production-gate-clearance.md`.

## Hosting decision

The repository contains a Docker-ready, long-lived Node service, but no HubZero
hosting account, deployed target, DNS delegation, secret manager, or production
proxy configuration is present. A production deployment therefore could not be
rehearsed honestly.

DigitalOcean App Platform is the recommended smallest managed target to evaluate
once HubZero provides an account: it accepts Docker/container deployments,
supports custom domains and HTTPS, has configurable readiness and liveness
checks, deployment rollback, runtime secrets, and logs. Configure one always-on
web service, forward the canonical host unchanged, use `/health/live` for
liveness and `/health/ready` for readiness, and keep the Node listener private
behind the platform TLS edge. A small Docker host plus Caddy remains the fallback
when a platform account is unavailable, but it shifts patching, monitoring, and
secret delivery onto HubZero.

This is a recommendation, **not a selected/deployed production target**. No
platform access was available to prove region, DNS, TLS termination, forwarding,
restart behavior, secret injection, or rollback. That is a required Phase 7
blocker. App Platform's documented container health checks and custom-domain
support informed the recommendation; the final app spec must be exported from
the selected account and reviewed before use.

## Read-only Studio inventory gate

The supplied Studio local configuration was checked without printing it. It is
ignored, untracked, absent from Git history, explicitly names the `hubzero`
database, and connected successfully to a replica set. Its authenticated role
is `readWriteAnyDatabase`, so the inventory was deliberately stopped before a
single `users` or other legacy collection query. No production Studio document
was read or written by Phase 6.

`npm run migration:studio:inventory -- --confirm-read-only` deliberately refuses
to fall back to `MONGODB_URI`. It requires `STUDIO_INVENTORY_MONGODB_URI`, an
explicit `hubzero` URI, and an authenticated MongoDB role set containing only
`read@hubzero`. It only issues `connectionStatus`, `find`, and
`countDocuments`; it has no write/index/session operation. A guarded output
file is optional and should be kept under ignored `artifacts/`; it contains no
password hashes or tokens. It reports the expected/observed count, Identity
normalization-v1 result, bcrypt metadata, account state, mapping-field presence,
and reference counts for ownership, attribution, assignment, editorial history,
and Team links.

Until a dedicated read-only credential is supplied, the actual account count,
email collision count, role distribution, password format distribution, Team
shapes, and CMS reference totals are **unknown**. There is intentionally no
Phase 7 migration manifest yet.

## Studio session hardening

Studio Auth.js JWTs previously carried role, disabled, and password-change
copies for their whole lifetime. Studio now treats the JWT as only a user ID and
`authVersion` generation. On every Node-side `auth()` call it reads the current
Studio user document, rejects a missing/disabled user or generation mismatch,
and projects the current role and password-change state. Middleware remains a
database-free coarse cookie gate; layouts, actions, route handlers, and API
authorization use the Node-side resolver.

Role changes, disable/enable, password resets, and password changes atomically
increment `authVersion` with the user mutation. Existing documents without the
field are generation zero. The Phase 7 all-session cutover mechanism is the
separate `invalidateAllSessions` repository primitive (`$inc: { authVersion: 1
}`); it has not been invoked outside isolated tests. This delivers immediate
server-side rejection after the state mutation completes without altering Studio
ObjectIds or CMS records.

## Protocol and migration status

Identity's canonical issuer, exact Studio callback contract, ES256 key model,
provider indexes, and OIDC client design remain unchanged. `email_verified`
continues to mean `emailVerifiedAt !== null`; administratively migrated Studio
accounts will be false until a real verification policy exists. Fitness is not
a Phase 6 gate: no Fitness repository/application exists, and no Fitness client
or secret is to be created before that product exists.

The production-shaped rehearsal from Phase 5 remains valid only for synthetic
fixtures. Actual production-shaped rehearsal, interrupted-run recovery, and
rollback must be repeated after the read-only inventory creates a reviewed,
hash-free manifest. Cross-database migration remains journalled and idempotent,
not falsely transactional.

## Required gate status

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Production host selected and accessible | BLOCKED | No HubZero platform account/target or DNS/proxy configuration was supplied. |
| Deploy/restart/proxy rehearsal | BLOCKED | Cannot truthfully run without the selected target. |
| Identity provider configuration, keys, indexes | BLOCKED | Local/Docker rehearsal passed in Phase 5; production initialization remains intentionally untouched. |
| Studio account inventory | BLOCKED | Existing credential is broad write; obtain `read@hubzero` credential. |
| Email/credential/role/CMS reconciliation | BLOCKED | Depends on the read-only inventory. |
| Stale role/session boundary | PASS | Current-user DB resolution plus atomic session generation invalidation. |
| Legacy-session global invalidation | PASS (isolated) | Dedicated atomic generation bump tested; never run on production. |
| Studio ↔ Identity true isolated browser flow | BLOCKED | Requires explicit isolated environment configuration for both real services. |
| Migration manifest | BLOCKED | Must be generated from approved read-only inventory. |
| Production-shaped migration/rollback rehearsal | BLOCKED | Must mirror actual inventory without copying sensitive production data. |
| Fitness | NOT APPLICABLE | No Fitness application exists; no client is registered. |

**Phase 7 gate: NO-GO.** Required blockers are the host/deployment rehearsal,
dedicated read-only Studio inventory, reviewable manifest and production-shaped
rehearsal, and a true Studio–Identity isolated browser proof.
