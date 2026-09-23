# Phase 6B — production gate clearance

Status: **NO-GO retained** · 2026-09-20.

Phase 6B was restricted to clearing the five Phase 6 blockers. It did not
create an Identity account, import a credential, create a membership, add a
Studio mapping, change Studio authentication mode, invalidate a Studio session,
or query a Studio collection.

## External-access evidence

Both Phase 6 worktrees were clean before this review. The Identity local
configuration contains only its database URI, not a deployment target's secret
set. It was never copied to a hosting project.

The dedicated Studio inventory credential was supplied only through ignored
local configuration. The guarded preflight accepted exactly one authenticated
role, `read@hubzero`, and reported `hubzero` as its target database. It
confirmed that the runtime `MONGODB_URI` was not used and that it executed no
write or index-initialization path. The normal Studio URI remains out of scope
because Phase 6 established its role as `readWriteAnyDatabase`; the inventory
guard must continue to reject it.

The subsequent hash-free production inventory was read-only. It observed the
expected five accounts, no existing `identitySubject` mapping, five unchanged
email-normalization-v1 results, zero invalid addresses/collisions, one
`headAdmin` and four `admin` roles, zero disabled accounts, and zero
`mustChangePassword` accounts. Every credential was structurally compatible
with the Phase 2 adapter: bcrypt `$2b$`, cost 12. No hash was exported or
retained in the repository.

CMS references use existing Studio ObjectIds: 1 Work, 1 Build, 20 Blueprints,
2 Labs, 89 Media records, 4 DocumentVersions, and 142 EditorialEvents refer to
the five-account population. The collection shapes are BSON `objectId` for
these fields. Five Team records exist, none has `userId`, and none links to a
migrating Studio user. Adding an additive user `identitySubject` therefore
requires neither CMS nor Team rewrite.

A temporary, operator-only, hash-free Phase 7 manifest proposes five new
opaque subjects at apply time, five explicit Studio memberships, and five
additive Studio mappings; it has zero warnings. The temporary inventory and
manifest artifacts are not repository files.

## Vercel hosting decision and evidence

The Docker-only conclusion was re-evaluated against current official Vercel and
Next.js documentation. Vercel supports Node.js Functions, Fluid Compute,
runtime environment variables, custom domains, runtime logs, and Mongo-compatible
`attachDatabasePool`; a root process listener is not its native deployment
shape. Next.js similarly cautions that a custom server is an ejection path and
loses optimizations.

Identity now routes canonical provider paths through an internal Vercel Node
Function to the existing `oidc-provider` bridge. The portable
`server.ts`/`dist/server.mjs` shape remains Docker fallback only. MongoDB
remains authoritative for sessions, interactions, provider artifacts, atomic
code consumption, and rate limiting; neither shape requires affinity to a
process. Vercel Previews deliberately reject enabled OIDC, so arbitrary preview
hosts cannot become issuers.

An authenticated, linked Vercel project was available for a constrained
rehearsal. Vercel CLI 59.23.2 built and deployed the application with Node 22
(the repository's `22.x` engine pin overrides the linked project's Node 24
default). The deployment became Ready in `iad1`; no Identity database,
application, client, signing key, account, credential, or session was
initialized.

An isolated test-only Vercel configuration was then deployed against
`hubzero_identity_rehearsal`, after its exact single-database role preflight.
Live returned `204`, readiness returned `200`, discovery used the explicit
HTTPS rehearsal issuer, JWKS contained only the active public ES256 key, and
an actual browser exercised generic failed sign-in plus synthetic Argon2
authentication and an HttpOnly Identity session. Deployment Protection was
restored after the isolated browser check. No production configuration or data
was used.

Vercel now verifies `auth.hubzero.in` as attached to this project. Cloudflare
remains the authoritative DNS provider by design; the subdomain has Vercel's
specified DNS-only CNAME and Vercel reports no conflict. A healthy,
rehearsal-only deployment is aliased to the domain, using
`hubzero_identity_rehearsal` rather than `hubzero` or the eventual production
Identity database.

At canonical HTTPS, `/health/live` returned `204` and `/health/ready` returned
`200`. Discovery reported exactly `https://auth.hubzero.in` and advertised
canonical `/authorize`, `/token`, and `/jwks` endpoints only. The real Vercel
browser rehearsal completed Authorization Code + PKCE S256 through password
authentication, active membership, interaction continuation, code exchange,
ES256 ID-token validation, and a rejected second exchange of the same code.
Runtime logs recorded the expected token requests without secret material. The
browser retained the canonical `__Host-hz_session` only with `Secure`,
`HttpOnly`, `SameSite=Lax`, `Path=/`, and host-only semantics.

This is canonical-host runtime evidence using only synthetic accounts, a
synthetic client, fresh rehearsal secrets, and the isolated database. It is
not production Identity initialization or a production user migration.

## Isolated rehearsal database preflight

`REHEARSAL_MONGODB_URI` was accepted only after a separate preflight verified
that it explicitly targets `hubzero_identity_rehearsal` and authenticates as
exactly `readWrite@hubzero_identity_rehearsal`. The runtime `MONGODB_URI` was
not used. No production database was contacted.

The new `setup-vercel-rehearsal` command is restricted to `APP_ENV=test` and
that database name. It applied 36 controlled indexes, then used the typed,
audited provisioning service to create only a synthetic rehearsal application,
explicit Studio membership, and synthetic account. This proves the Atlas role,
transactions, index migration, and provisioning path for the isolated target.
It is not a Vercel runtime proof: a coherent rehearsal-only Vercel secret set,
temporary issuer/client configuration, deployment, and cross-request protocol
exercise remain required.

## Blocker disposition

| Phase 6 blocker | Status | Evidence / required input |
| --- | --- | --- |
| Identity production host | PASS | Vercel Node 22 runtime is live behind the verified canonical domain with isolated rehearsal configuration; readiness, discovery, JWKS, real Authorization Code + PKCE exchange, replay rejection, and the production cookie contract pass. |
| Read-only Studio inventory | PASS | Guarded preflight verified exactly `read@hubzero`; production inventory was hash-free and read-only. |
| Production-shaped rehearsal | PASS | Synthetic five-account fixture mirrors observed roles, states, bcrypt category/cost, ObjectId reference shapes, and Team shape. |
| Real Studio ↔ Identity browser proof | BLOCKED | Requires isolated running Identity and Studio deployments, databases, test client, and test mapping. |
| Final Phase 7 gate | BLOCKED | Required prerequisite gates remain blocked. |

The remaining browser-proof precondition is specifically an ignored
`STUDIO_REHEARSAL_MONGODB_URI` scoped to `hubzero_studio_rehearsal`; the normal
Studio runtime URI is deliberately not used as a substitute.

## Exact unblockers

### Studio browser proof

Supply an ignored local `STUDIO_REHEARSAL_MONGODB_URI` that explicitly targets
only `hubzero_studio_rehearsal` with
`readWrite@hubzero_studio_rehearsal`. Then initialize the synthetic fixture
through controlled tooling and run the actual Studio application in `dual`
mode against the actual Identity provider. The existing Studio runtime URI is
not an acceptable substitute.

### Inventory

The scoped credential requirement is satisfied. It remains available only as
`STUDIO_INVENTORY_MONGODB_URI` for the guarded command, never as a runtime
credential or migration input.

## Security and dependency review

Identity's current production dependency audit remains `0` findings. Studio's
current production audit remains `3 moderate, 0 high, 0 critical`:

| Package | Disposition |
| --- | --- |
| `next` | Upgrade path is Next 16.3.5, a major framework change; defer outside migration preparation. |
| `postcss` | Fixed through the same Next major upgrade; not on the Identity/OIDC path independently. |
| `sanitize-html` | A non-major 2.17.7 fix exists; evaluate separately with content-sanitization regression coverage rather than bundling it into cutover work. |

There is no unresolved high/critical authentication dependency finding. Existing
secret scans remain clear of production credentials; no production inventory
artifact exists in the repository.

## Gate recomputation

| Required gate | Status |
| --- | --- |
| Vercel runtime compatibility and repository adapter | PASS |
| Hosting target selected | PASS |
| Vercel deployment and liveness | PASS |
| Vercel HTTPS/proxy, readiness, secrets, custom domain, canonical issuer, deployed Authorization Code + PKCE/replay, and production cookie | PASS |
| Concurrent replay stress, exhaustive distributed persistence, live A-to-B signing rotation, and live rollback exercise | NOT APPLICABLE (post-Phase-7 operational hardening) |
| Scoped read-only credential and actual inventory | PASS |
| Account count, normalization, credentials, CMS, Team evidence | PASS |
| Studio auth freshness and isolated invalidation rehearsal | PASS |
| Auth modes remain safe | PASS |
| Same-ObjectId, real browser SSO, critical denial, and Studio-authority proof | BLOCKED |
| Sanitized production-shaped fixture and manifest | PASS |
| Dry run, migration, idempotency, interruption, reconciliation, rollback | PASS |
| No high/critical auth dependency finding | PASS |
| Secret handling and no production mutation | PASS |
| Fitness | NOT APPLICABLE |

**Phase 7 gate: NO-GO.**

The only remaining required work is the real isolated Studio-to-Identity browser
proof. Concurrent replay stress, exhaustive distributed persistence, live
signing-key rotation, live Vercel rollback, and an exhaustive callback-negative
browser matrix remain explicitly tracked as post-Phase-7 operational hardening;
they are not waived or claimed as executed.
