# Phase 6B — production gate clearance

Status: **NO-GO retained** · 2026-09-20.

Phase 6B was restricted to clearing the five Phase 6 blockers. It did not
create an Identity account, import a credential, create a membership, add a
Studio mapping, change Studio authentication mode, invalidate a Studio session,
or query a Studio collection.

## External-access evidence

Both Phase 6 worktrees were clean before this review. The available machine has
Docker only; it has no configured DigitalOcean, Railway, Fly, Render, or Vercel
deployment CLI/token. The Identity local configuration contains only its
database URI, not a deployment target, deployment secret set, DNS/proxy setup,
or hosting credential. No production hosting account or target was supplied.

The Studio local configuration has no `STUDIO_INVENTORY_MONGODB_URI`. Running
the guarded inventory with its explicit acknowledgement stopped before creating
a MongoDB client:

```text
STUDIO_INVENTORY_MONGODB_URI is required; MONGODB_URI is never used for Studio inventory
```

The normal Studio URI remains out of scope because Phase 6 established its role
as `readWriteAnyDatabase`. The inventory command must continue to require a
dedicated `read@hubzero` credential and must not be amended to accept this
application credential.

## Blocker disposition

| Phase 6 blocker | Status | Evidence / required input |
| --- | --- | --- |
| Identity production host | BLOCKED | No selected or accessible HubZero host, DNS/TLS/proxy, secret manager, or deployment account. |
| Read-only Studio inventory | BLOCKED | No scoped `STUDIO_INVENTORY_MONGODB_URI`; normal write-capable URI was not used. |
| Production-shaped rehearsal | BLOCKED | Depends on a reviewed inventory and sanitized manifest. |
| Real Studio ↔ Identity browser proof | BLOCKED | Requires isolated running Identity and Studio deployments, databases, test client, and test mapping. |
| Final Phase 7 gate | BLOCKED | Required prerequisite gates remain blocked. |

## Exact unblockers

### Hosting

Provide access to one selected long-lived Node/Docker target. The recommended
candidate remains DigitalOcean App Platform, but it is not a decision until an
authorized HubZero account is available. The target needs a non-production
rehearsal hostname (unless `auth.hubzero.in` is explicitly prepared), Docker
deployment permission, custom-domain/TLS/proxy control, runtime secret manager,
logs, rollback deployment access, and Atlas network access. Supply only the
required secret references/values through that target's secret manager; do not
put them in Git or local documentation.

### Inventory

Provide a separate MongoDB principal with exactly `read` on `hubzero` and no
write/admin role. Set it only as `STUDIO_INVENTORY_MONGODB_URI` for the guarded
command. The command will verify its database and roles before issuing its
read-only inventory queries. It must not share the Studio runtime principal.

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
| Hosting target selected | BLOCKED |
| Deployment, HTTPS/proxy, health, restart, secrets, signing rotation | BLOCKED |
| Scoped read-only credential and actual inventory | BLOCKED |
| Account count, normalization, credentials, CMS, Team evidence | BLOCKED |
| Studio auth freshness and isolated invalidation rehearsal | PASS |
| Auth modes remain safe | PASS |
| Same-ObjectId, real browser SSO, denial/callback/email/logout proof | BLOCKED |
| Sanitized production-shaped fixture and manifest | BLOCKED |
| Dry run, migration, idempotency, interruption, reconciliation, rollback | BLOCKED |
| No high/critical auth dependency finding | PASS |
| Secret handling and no production mutation | PASS |
| Fitness | NOT APPLICABLE |

**Phase 7 gate: NO-GO.**

The only remaining work is to obtain the hosting and scoped read-only inventory
access above, then run the already-designed deployment, inventory, manifest,
rehearsal, and real browser proofs. Do not start Phase 7 until every required
gate is PASS.
