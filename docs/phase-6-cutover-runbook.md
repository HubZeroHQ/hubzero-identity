# Phase 7 controlled initialization and cutover runbook

Status: preparation only. The production migration executor is implemented and
the controlled production indexes were initialized on 2026-09-24, but **no
production user migration may run until a new apply approval and the remaining
Phase 7 stage gates are recorded**. Studio remains legacy-only.

Identity authenticates; Studio authorizes. The migration creates opaque `hz_`
subjects and explicit Studio memberships, then adds each subject to the
pre-existing Studio user. Studio ObjectIds, roles, `authVersion`, CMS references,
and Team documents remain unchanged.

## Executor contract

`scripts/studio-migration-executor.ts` is the **single** executor used in the
isolated rehearsal and eventual production operation. Supported commands are
`plan`, `apply`, `status`, `reconcile`, and `resume`. `plan` and `status` do not
write. `apply`, `resume`, and `reconcile` require an operator-supplied verified
recovery reference in production. The reference is a checkpoint identifier,
not a substitute for manually verifying recoverability.

All commands require a stable `--run-id`, `--expected-account-count 5`,
`--environment production`, and `--confirm-production`. The production source
must be exactly `hubzero`; the target must be exactly `hubzero_identity`. The
script checks the URI path and authenticated MongoDB role independently before
reading collections. It never uses runtime `MONGODB_URI` as a fallback.

| Scope | Secret variable supplied by operator | Required sole MongoDB role |
| --- | --- | --- |
| Production plan/status | `STUDIO_INVENTORY_MONGODB_URI` | `read@hubzero` |
| Production apply/resume/reconcile | `STUDIO_MIGRATION_MONGODB_URI` | `readWrite@hubzero` |
| Production Identity target | `IDENTITY_MIGRATION_MONGODB_URI` | `readWrite@hubzero_identity` |
| Isolated rehearsal Studio | `STUDIO_REHEARSAL_MONGODB_URI` | `readWrite@hubzero_studio_rehearsal` |
| Isolated rehearsal Identity | `REHEARSAL_MONGODB_URI` | `readWrite@hubzero_identity_rehearsal` |

The dedicated production migration credentials were independently preflighted
on 2026-09-24 as exactly `readWrite@hubzero` and
`readWrite@hubzero_identity`. Recheck them before later operations. Do not
reuse the Studio runtime account or grant broader Atlas roles. Never print,
paste into docs, or commit any connection string.

## Production logical recovery point (2026-09-24)

Atlas native backup/PITR is unavailable on the current cluster tier. The
pre-apply recovery method is therefore a pair of MongoDB Database Tools
archives, stored under
`Documents/HubZero/phase7-operator-backups/<recovery-reference>/` in a
restricted operator directory outside both repositories and Git. This is a
logical snapshot, **not PITR**: the databases
were dumped sequentially, and later production changes are not recoverable
from this reference. Maintain the identity/account-change freeze and confirm
this reference is still fresh before any migration write. Production restore
requires a separately reviewed procedure; do not blindly overwrite a live
database.

| Recovery metadata | Verified value |
| --- | --- |
| Reference | `phase7-preapply-20260924T112727Z` |
| Verification completed (UTC) | 2026-09-24 11:27:46 |
| Coverage | `hubzero`, `hubzero_identity` |
| Tools | `mongodump` and `mongorestore` 100.18.0; isolated MongoDB 8.0.32 |
| Archives | `hubzero.archive.gz` (97,291 bytes); `hubzero_identity.archive.gz` (116 bytes) |
| SHA-256 | Both recorded in restricted external `recovery-metadata.json`; not copied into Git |
| Source host | Sanitized host fingerprints recorded in external metadata |
| Restore verification | PASS, isolated local container; remapped to `phase7_verify_studio.*` and `phase7_verify_identity.*` |

The Studio restore reproduced five users (one `headAdmin`, four `admin`), zero
invalid emails, zero existing mappings, and five structurally present bcrypt
credentials. Source-versus-restore comparisons matched all collection counts,
index metadata, original Studio ObjectIds, CMS/Media/DocumentVersions/
EditorialEvents reference counts, and five Team records with no `userId`
links. The production Identity target currently has **zero collections** and
zero migration journal entries; its 116-byte archive and empty isolated
restore reflect that state accurately, not an initialized schema. Source
collection/index metadata was unchanged before and after the dumps. No
production collection was written during backup or verification.

To verify these archives again, use MongoDB Database Tools 100.18.0 or a
compatible version. Check both SHA-256 values against the restricted external
metadata. Start a **disposable local MongoDB instance**, then restore each
archive with `mongorestore --archive=<archive> --gzip`, specifying
`--nsFrom=hubzero.* --nsTo=<empty-isolated-studio-db>.*` and
`--nsFrom=hubzero_identity.* --nsTo=<empty-isolated-identity-db>.*`,
respectively. Verify collection counts, indexes, five original Studio
ObjectIds, and CMS/Team reference integrity before declaring recovery viable.
Never point this verification at Atlas production or an existing rehearsal
database. An empty Identity archive may restore no collections; that matches
the recorded pre-migration target state.

### Infrastructure-write recovery and current checkpoint

The older `phase7-preapply-20260924T112727Z` reference above is historical;
it was too old for the first infrastructure write. A fresh sequential logical
backup was created and verified by an isolated restore immediately beforehand:

| Recovery metadata | Verified value |
| --- | --- |
| Reference | `phase7-preinfra-20260924T170010Z` |
| Verification completed (UTC) | 2026-09-24 17:00:29 |
| Coverage | `hubzero`, `hubzero_identity` |
| Tools | `mongodump` and `mongorestore` 100.18.0; isolated MongoDB 8.0.32 |
| Archives | `hubzero.archive.gz` (97,870 bytes); `hubzero_identity.archive.gz` (116 bytes) |
| SHA-256 | Both stored and checked in restricted external `recovery-metadata.json`, not Git |
| Restore verification | PASS; collection/index metadata, five Studio ObjectIds, and CMS/Team reference counts matched |

The archives and metadata remain outside the repositories under the operator
backup directory above. The source credentials were independently verified as
the sole roles `readWrite@hubzero` and `readWrite@hubzero_identity`, with exact
URI database targets and no runtime or rehearsal fallback. No production
collection was written while creating or restoring these archives.

After that recovery check, the controlled initialization created 38 required
Identity indexes and 3 Studio OIDC indexes. The latter include the reviewed
sparse unique `users.identitySubject` index and the two Studio OIDC handoff
indexes. A subsequent read-only verification found 16 Identity collections,
zero Identity users, credentials, memberships, or migration-journal entries,
five Studio users, zero `identitySubject` mappings, and no missing required
indexes. These index/collection creations are the **only production database
mutations in this preparation checkpoint**. No Studio user, ObjectId, CMS or
Team reference, session, or auth mode was changed.

Production application registration and runtime promotion remain pending.
The locally available Identity runtime `MONGODB_URI` was independently found to
authenticate with the broad `readWriteAnyDatabase@admin` role; it must **not**
be deployed as the production runtime credential. Provision a dedicated
runtime credential scoped to `readWrite@hubzero_identity`, then configure a
coherent production-only Vercel secret set and the production Studio client.
The currently healthy `auth.hubzero.in` deployment still uses its isolated
rehearsal configuration. Do not overwrite its secret set piecemeal or infer
production readiness from its HTTP 200 response. No guarded five-account
production PLAN has yet passed this checkpoint, and no production apply was
run.

Before any later production **apply**, reassess recovery freshness and take a
new verified logical backup after the infrastructure/client setup if meaningful
time or production state has changed. The pre-infrastructure archive is not
automatically a sufficiently fresh pre-apply recovery point.

## Production operator sequence (not executed in preparation)

Before these commands: record clean repo SHAs and known-good deployments, freeze
identity/account mutations, manually verify an identifiable recovery point
for **both** databases, compare a fresh guarded inventory with the accepted five
accounts, initialize/verify Identity indexes (including
`studio_migration_journal.uniq_source_step`), verify Studio's sparse unique
`users.identitySubject` index, and register the enabled production `studio`
application. Keep `STUDIO_AUTH_MODE=legacy` throughout migration and
reconciliation.

Run from the Identity repository with secrets injected securely into the
invoking process. Use the **same** run ID throughout; never put URIs in command
arguments. The backup reference is a non-secret, manually verified recovery
identifier, not a credential.

```text
tsx scripts/studio-migration-executor.ts plan --environment production --confirm-production --expected-account-count 5 --run-id <approved-run-id>
tsx scripts/studio-migration-executor.ts status --environment production --confirm-production --expected-account-count 5 --run-id <approved-run-id>
tsx scripts/studio-migration-executor.ts apply --environment production --confirm-production --expected-account-count 5 --run-id <approved-run-id> --backup-reference <verified-recovery-id>
tsx scripts/studio-migration-executor.ts reconcile --environment production --confirm-production --expected-account-count 5 --run-id <approved-run-id> --backup-reference <verified-recovery-id>
tsx scripts/studio-migration-executor.ts apply --environment production --confirm-production --expected-account-count 5 --run-id <approved-run-id> --backup-reference <verified-recovery-id>
```

If `apply` stops after a durable checkpoint, inspect `status`, re-check source
drift and recovery readiness, then use `resume` with the **same** run ID and
backup reference. Do not use ad hoc MongoDB edits. The Identity import is one
transaction for user, bcrypt credential, membership, and security events. A
crash after that transaction but before its journal entry is recognized from
the import idempotency key; the missing checkpoint is recovered. Studio mapping
uses a conditional update on the existing `_id` and the sparse unique index.
The next run recognizes a completed mapping without rewriting it.

The journal is append-only with unique source/step checkpoints:
`identity_imported`, `studio_mapped`, `reconciled`. It records run ID, Studio
ObjectId, opaque subject, and time only; it stores no password hash, password,
URI, token, or secret. The existing Identity import record retains its private
source fingerprint. Every plan revalidates account count, email normalization,
bcrypt syntax, source fingerprint, application, existing Identity ownership,
mapping, journal run, and required uniqueness indexes. Any drift/conflict is a
stop. A complete rerun should report zero identities created and zero mappings
written.

`reconcile` independently checks all five Studio ObjectIds against Identity
users, current imported bcrypt credentials, active Studio memberships, Studio
`identitySubject` mappings, and journal checkpoints. It writes reconciliation
checkpoints only after the entire batch passes. CMS and Team collections are
never mutation targets of the executor. Normal CMS edits may continue; this
does not substitute for the separate Phase 7 read-only reference check.

The executor is intentionally for the **pre-cutover import window**. After
users authenticate and bcrypt credentials upgrade to Argon2id, the original
Studio hash no longer equals the Identity credential. Do not rerun the import
executor after cutover; use operational account tooling instead.

## Isolated rehearsal evidence

On 2026-09-24, the exact executor was run against
`hubzero_studio_rehearsal` → `hubzero_identity_rehearsal`, using only five
synthetic fixture ObjectIds. This rehearsal-only subset prevents alteration of
the separate browser-E2E fixture user; production mode has **no** subset option
and counts every Studio user. The guarded seed initialized the two journal
indexes and idempotently created five synthetic Studio users plus CMS/Team
reference shapes. The rehearsal CLI accepted exactly one scoped
`readWrite@<rehearsal-database>` role for each database.

| Check | Result |
| --- | --- |
| Plan | 5 accounts: 1 headAdmin, 4 admin; all create |
| Deliberate interruption | After first Identity transaction: 1 import checkpoint, 0 mappings |
| Resume | 4 further Identity imports, 5 conditional Studio mappings |
| Reconcile | 5 users, 5 bcrypt credentials, 5 memberships, 5 mappings, 5 reconciled checkpoints |
| Second apply | 0 created, 0 mapped; 15 total distinct checkpoints |
| Conflicting run ID | Rejected before mutation |
| CMS/Team | Read-only verifier confirmed 274 original-ObjectId references and 5 unchanged Team records; executor has no writes to these collections |

The rehearsal left only synthetic records in isolated databases. It did not
contact `hubzero` or `hubzero_identity`. The same executor also passed its
four-case local MongoDB replica-set integration suite: Identity-transaction
and partial-Studio-mapping interruption recovery, idempotency, rejection of
unsupported or conflicting source states, and rejection of a conflicting run
ID. The test compared CMS and Team fixture documents before and after
migration unchanged.

## Stage gates after executor preparation

1. Reconfirm the recorded logical recovery reference and both archive
   checksums, archive accessibility, isolated restore result, and account-change
   freeze. **Stop if recovery evidence is unavailable or stale.**
2. Complete the Phase 7 pre-mutation baseline, account-change freeze, final
   guarded inventory, and source/target scoped credential/index preflight.
3. Review the five-account plan with a second operator before `apply`.
4. Run `apply`, `reconcile`, and the zero-write rerun while Studio remains
   legacy-only. Stop on any mismatch; use `status`/`resume` for interruption.
5. Only after full reconciliation, follow the separately accepted dual-mode
   canary, five-user verification, OIDC-only cutover, session invalidation,
   and rollback-window stages. Retain Studio bcrypt hashes and additive
   Identity records as rollback material; do not remove them automatically.

Fitness is outside this migration. No Fitness client or membership is created.
