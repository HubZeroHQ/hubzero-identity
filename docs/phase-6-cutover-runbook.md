# Phase 7 controlled initialization and cutover runbook

Status: controlled production import complete, authentication cutover not
started. On 2026-09-24 the approved five-account APPLY, reconciliation, and
idempotent rerun passed against the verified post-infrastructure recovery
point. **Studio remains legacy-only. Dual mode, OIDC canaries, and session
invalidation require the next explicit operator approval.**

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

### Final pre-apply logical recovery point (2026-09-24)

The post-infrastructure backup is stored outside both repositories and Git in
the restricted operator backup directory:

| Recovery metadata | Verified value |
| --- | --- |
| Reference | `phase7-final-preapply-20260924T175625Z` |
| Restore verification completed (UTC) | 2026-09-24 17:56:39.822 |
| Databases | `hubzero`, `hubzero_identity` |
| Tools | `mongodump` and `mongorestore` 100.18.0; isolated MongoDB 8.0.32 |
| Archives | `hubzero.archive.gz` (97,386 bytes); `hubzero_identity.archive.gz` (2,116 bytes) |
| SHA-256 | Full checksums recorded and independently matched in restricted external `recovery-metadata.json`; not copied into Git |
| Recovery type | Sequential logical backup, **not PITR** or an atomic cross-database snapshot |
| Isolated restore | PASS; namespace-remapped into disposable local databases/container, never over production or rehearsal |

Both scoped production credentials were rechecked as exactly
`readWrite@hubzero` and `readWrite@hubzero_identity`, with explicit URI database
targets and no runtime/rehearsal fallback. Source snapshots before and after
the dumps matched, including collection counts, index definitions, and
document fingerprints held only in verifier memory. Restored snapshots matched
the source for all collections, indexes, and documents. All five original
Studio BSON ObjectIds, representative CMS/Media/DocumentVersions/
EditorialEvents references, and Team relationships survived the round-trip.
The Studio restore has exactly five users (one `headAdmin`, four `admin`), zero
`identitySubject` mappings, zero invalid/colliding normalized emails, five
supported `$2b$` cost-12 credentials, and the sparse unique mapping index plus
the other required OIDC indexes. The Identity restore has the enabled
production `studio` client, all required indexes, zero users, zero credentials,
zero memberships, and zero migration-journal entries. No source drift from
the approved five-account PLAN was observed.

The archive checksums were independently rechecked after restore. No temporary
URI configuration file or restore container remains; the restricted backup
folder contains the retained archives and metadata. No production database
write was made during backup or verification. Before **apply**, the operator
must recheck archive accessibility, both checksums, the identity/account-change
freeze, current source state, and recovery freshness. If material state changed
or the sequential logical point is no longer sufficiently fresh, create and
verify another backup. Explicit operator approval for apply is still required;
Studio remains legacy-only until full migration reconciliation passes.

### Approved production migration checkpoint (2026-09-24)

Explicit operator approval named recovery reference
`phase7-final-preapply-20260924T175625Z`. Immediately before APPLY, both
archive SHA-256 values matched the restricted external metadata, the isolated
restore reference was still verified and approximately seven minutes old, and
the scoped credentials independently authenticated as exactly
`readWrite@hubzero` and `readWrite@hubzero_identity`. A read-only guarded PLAN
again reported five `create` actions, one `headAdmin` and four `admin`, with no
conflicts. A separate read-only comparison against freshly restored archive
copies found no changed production source collection, document, or index; five
Studio users still had supported `$2b$` cost-12 credentials, zero normalization
collisions, and zero mappings. Identity still had zero users, credentials,
memberships, and journal entries; the enabled Studio client and all required
indexes were present.

The reviewed executor used run ID `phase7-production-20260924` and the exact
`hubzero` → `hubzero_identity` targets. APPLY created five opaque `hz_` Identity
users, imported five current Studio bcrypt credentials, created five explicit
Studio memberships, and added five `identitySubject` mappings to the existing
Studio users. The first result had five `identity_imported` and five
`studio_mapped` journal checkpoints. Immediate executor reconciliation passed
five complete source → subject → credential → membership → mapping chains and
added five `reconciled` checkpoints. A read-only PLAN then reported five
`complete` actions; the supported second APPLY was a no-op: zero new users,
zero new mappings, and 15 total distinct checkpoints.

An independent read-only post-apply check found exactly five unique subjects,
five credentials, five active Studio memberships, five one-to-one mappings,
and all three journal steps per source account. Comparing a disposable restore
of the approved pre-apply Studio archive with current production documents
showed that all five original BSON ObjectIds, roles, disabled states,
`authVersion` values, other user fields (except the additive mapping and
`updatedAt`), and full CMS/Team documents were unchanged. No manual MongoDB
repair or resume was needed.

After import, Identity live/ready/discovery/JWKS returned 204/200/200/200;
discovery remained canonical and JWKS retained the public production signing
key. Production Studio still served its legacy email/password form (HTTP 200)
and did not show the OIDC login action. No production password was supplied to
the operator, so a successful legacy credential login was **not** performed in
this checkpoint; the deployed legacy path and configuration were unchanged.
No OIDC canary, auth-mode change, or session invalidation occurred. Retain the
Studio bcrypt hashes, additive mappings, migration journal, and recovery
archives as rollback material. Stop here pending separate dual-mode approval.

## Production operator sequence (historical import commands; do not rerun after cutover)

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

## Next stage gate

The recovery, preflight, production PLAN, APPLY, reconciliation, and no-op
rerun above are complete. **Do not rerun the import executor after users begin
authenticating and credentials upgrade to Argon2id.** The next separately
approved stage is dual-mode deployment and a production OIDC canary, followed
only after its own gates by five-user verification, OIDC-only cutover, session
invalidation, and the rollback window. Preserve Studio bcrypt hashes and the
additive Identity records as rollback material; do not remove them
automatically.

Fitness is outside this migration. No Fitness client or membership is created.
