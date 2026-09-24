# Phase 7 controlled initialization and cutover runbook

Status: preparation only. Production indexes, the Studio OIDC application,
and the canonical Identity runtime are initialized; the guarded five-account
PLAN passed on 2026-09-24. **No production user migration may run until a new
post-infrastructure recovery point and explicit apply approval are recorded.**
Studio remains legacy-only.

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
indexes. At that checkpoint, index/collection creation was the only production
database mutation. No Studio user, ObjectId, CMS or Team reference, session,
or auth mode was changed.

### Production runtime, client, and PLAN checkpoint (2026-09-24)

`IDENTITY_RUNTIME_MONGODB_URI` was independently checked: exact URI database
`hubzero_identity`, sole effective role `readWrite@hubzero_identity`, no
fallback. The separate broad `readWriteAnyDatabase@admin` local runtime URI
was **not** used or deployed. The existing migration credentials retained
their exact scoped roles. All Vercel Production Identity variables were
replaced as one coherent production-only set, using fresh HMACs, a fresh ES256
key (`phase7-production-a-20260924` active), the scoped runtime URI, and a
fresh production Studio client secret. Only variable names and the public
`kid` are recorded here. Studio's Production Vercel environment received the
matching OIDC issuer, client ID, exact callback, client secret, and independent
transaction key; `STUDIO_AUTH_MODE` was not changed and Studio was not
redeployed. No rehearsal or production secret value is recorded in Git.

The guarded `application:studio:register:production` command registered the
enabled, first-party, confidential `studio` application with client ID
`hubzero-studio`, secret reference `studio-production`, and sole exact redirect
`https://hubzero.in/studio/oidc/callback`. The callback route exists in the
deployed Studio implementation. Registration was the only additional
intentional production infrastructure database write. Its second invocation
recognized the same client
with zero writes. It created no users or memberships.

Identity deployment `dpl_B4Wnt2VM3rttjuES6ZHWV9RbfHX2` was built as a staged
Production deployment and promoted to `auth.hubzero.in` only after the build
passed. The prior deployment `dpl_3co4Hv8ox3iYEs49MtxCtJ6N9TRu` was recorded
before promotion. On the canonical domain, TLS verification succeeded;
`/health/live` returned 204 and `/health/ready`, discovery, and JWKS returned
200. Discovery reported issuer `https://auth.hubzero.in` and authorization,
token, and JWKS endpoints on that origin. JWKS exposed only public ES256 key
`phase7-production-a-20260924`. An unauthenticated `prompt=none` request for
the production Studio client returned `login_required` to the exact Studio
callback, while the rehearsal client was rejected. Together with the scoped
runtime credential installation and the production-only application record,
this distinguishes the deployed `hubzero_identity` runtime from the old
rehearsal database. A protected noncanonical deployment request reached the
Function and returned 421. A synthetic invalid-session cleanup request on the
canonical domain set `__Host-hz_session` with Secure, HttpOnly, SameSite=Lax,
Path=/, and no Domain; no cookie value was recorded. There are no production
users yet, so a real login cookie was not issued in this preparation stage.

The guarded production PLAN used `--environment production`,
`--confirm-production`, `--expected-account-count 5`, run ID
`phase7-production-20260924`, and recovery reference
`phase7-preinfra-20260924T170010Z`. It independently selected the read-only
`read@hubzero` Studio inventory credential and `readWrite@hubzero_identity`
target credential, with no runtime/rehearsal fallback. Result: five source
accounts (one `headAdmin`, four `admin`), five `create` actions, zero resume or
conflict actions. The reviewed executor maps each create action to one opaque
Identity subject, imported current bcrypt credential, explicit Studio
membership, and additive mapping to the unchanged Studio ObjectId. It has no
CMS or Team mutation target. Post-PLAN read-only checks still found zero
Identity users, credentials, memberships, journal entries, or Studio mappings.
**No apply, resume, or reconcile was run.**

Before any later production **apply**, take and verify a **new** logical backup
of both databases after this infrastructure/client setup. The pre-infrastructure
archive is acceptable for PLAN review only, not the final apply recovery point.
Obtain explicit operator approval for apply; retain Studio legacy-only mode
until full migration reconciliation passes.

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
