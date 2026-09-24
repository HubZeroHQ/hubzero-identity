# Phase 7 controlled initialization and cutover runbook

Status: preparation only. The production migration executor is implemented, but
**no production migration may run until Atlas backup/PITR evidence and the other
Phase 7 stage gates are recorded and approved**. This document does not authorize
production writes or a Studio auth-mode change.

Identity authenticates; Studio authorizes. The migration creates opaque `hz_`
subjects and explicit Studio memberships, then adds each subject to the
pre-existing Studio user. Studio ObjectIds, roles, `authVersion`, CMS references,
and Team documents remain unchanged.

## Executor contract

`scripts/studio-migration-executor.ts` is the **single** executor used in the
isolated rehearsal and eventual production operation. Supported commands are
`plan`, `apply`, `status`, `reconcile`, and `resume`. `plan` and `status` do not
write. `apply`, `resume`, and `reconcile` require an operator-supplied Atlas
backup/PITR reference in production. The reference is a checkpoint identifier,
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

Neither production write credential is implied to exist today. Do not reuse the
Studio runtime account or grant broader Atlas roles to make the executor run.
Provision scoped credentials as a separate approved Phase 7 prerequisite. Never
print, paste into docs, or commit any connection string.

## Production operator sequence (not executed in preparation)

Before these commands: record clean repo SHAs and known-good deployments, freeze
identity/account mutations, manually verify an identifiable Atlas recovery point
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

1. Manually verify and record Atlas backup/PITR restore evidence for both
   production databases. **Stop if unavailable.**
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
