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

The project currently has **no environment variables**. `/health/live` returns
`204`, while `/health/ready` returns `500` without disclosing configuration,
proving that the deployment can answer liveness traffic but fails closed when
required configuration is absent. Vercel Deployment Protection is enabled for
ordinary public traffic. This is appropriate for the constrained rehearsal but
must be deliberately reconciled with the public provider domain before
production use.

`auth.hubzero.in` is known to the Vercel account but DNS is still delegated to
Cloudflare and Vercel reports the required subdomain A record is absent. No DNS,
domain attachment, environment-variable, or protection-policy change was made.
Consequently there is no custom-domain TLS, canonical issuer, Account,
sign-in, OIDC, key-rotation, restart, or rollback proof yet. See
[`vercel-deployment.md`](vercel-deployment.md) for the exact contract and next
rehearsal sequence.

## Blocker disposition

| Phase 6 blocker | Status | Evidence / required input |
| --- | --- | --- |
| Identity production host | BLOCKED | Vercel is selected and the application deployed successfully, but custom-domain TLS, explicit secrets, public-access policy, and an isolated runtime rehearsal remain incomplete. |
| Read-only Studio inventory | PASS | Guarded preflight verified exactly `read@hubzero`; production inventory was hash-free and read-only. |
| Production-shaped rehearsal | PASS | Synthetic five-account fixture mirrors observed roles, states, bcrypt category/cost, ObjectId reference shapes, and Team shape. |
| Real Studio ↔ Identity browser proof | BLOCKED | Requires isolated running Identity and Studio deployments, databases, test client, and test mapping. |
| Final Phase 7 gate | BLOCKED | Required prerequisite gates remain blocked. |

## Exact unblockers

### Hosting

Configure an isolated Vercel rehearsal deployment with its own non-production
Atlas database, signing keyset, test client credentials, and test identity.
Then verify the canonical custom domain only when `auth.hubzero.in` DNS/TLS and
the public-access policy are explicitly approved. Supply secrets only through
Vercel's environment settings; do not put them in Git or local documentation.

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
| Vercel HTTPS/proxy, readiness, secrets, signing rotation, custom domain, restart/rollback | BLOCKED |
| Scoped read-only credential and actual inventory | PASS |
| Account count, normalization, credentials, CMS, Team evidence | PASS |
| Studio auth freshness and isolated invalidation rehearsal | PASS |
| Auth modes remain safe | PASS |
| Same-ObjectId, real browser SSO, denial/callback/email/logout proof | BLOCKED |
| Sanitized production-shaped fixture and manifest | PASS |
| Dry run, migration, idempotency, interruption, reconciliation, rollback | PASS |
| No high/critical auth dependency finding | PASS |
| Secret handling and no production mutation | PASS |
| Fitness | NOT APPLICABLE |

**Phase 7 gate: NO-GO.**

The only remaining work is to obtain the hosting and scoped read-only inventory
access above, then run the already-designed deployment, inventory, manifest,
rehearsal, and real browser proofs. Do not start Phase 7 until every required
gate is PASS.
