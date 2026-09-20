# Phase 7 controlled initialization and cutover runbook

Status: proposed only — do not execute from Phase 6 until every required gate in
`phase-6-precutover-validation.md` is PASS.

Every step needs a named change owner, two-person review for source/manifest data,
a recorded timestamp, and an explicit go/no-go decision. Stop at the first failed
precondition; never compensate with direct MongoDB edits.

| Step | Precondition and verification | Rollback / stop action |
| --- | --- | --- |
| Backups and window | tested Studio/Identity restore, approved window/operators | do not begin |
| Deploy Identity | confirmed Node host, canonical proxy, Account/RSC/assets/health | roll back image/config |
| Validate provider | discovery issuer, JWKS public keys, S256, signing key | disable provider |
| Apply Identity indexes | approved dry run has no conflicts | stop; never drop indexes blindly |
| Register clients | exact Studio/Fitness callbacks and independent secrets | disable client/config reference |
| Source inventory | constrained read-only Studio access, count/roles/bcrypt/collisions | stop on discrepancy |
| Approve manifest | each ObjectId, status, memberships, expected role approved | revise manifest only |
| Dry run | target/index preconditions and totals match inventory | preserve artifact, stop |
| Import Identity | explicit production apply/run ID/idempotency checks | quarantine additive Identity data |
| Add Studio mappings | sparse unique index, exact subject/ObjectId pairs | remove new mapping only after audit approval |
| Reconcile | one-to-one/status/credential/membership totals; CMS refs unchanged | restore legacy mode and investigate |
| Controlled OIDC proof | approved account callback/role/ownership continuity | disable OIDC route |
| Enable dual mode | legacy login still works; both paths same Studio user | set `legacy` |
| Cut over | acceptance gate and rollback window open | return to `dual` or `legacy` |
| Invalidate legacy sessions | cutover checkpoint passed; old cookies denied | only restore under incident approval |
| Retire credentials later | retention/acceptance period complete | separate recoverable approval |

## Migration journal and reruns

The Phase 6 apply command must create an append-only access-controlled journal in
Identity. Each entry records migration run ID, source Studio ObjectId, Identity
subject, non-secret source fingerprint, completed Identity/membership/mapping
checkpoints, reconciliation state, and safe error/rollback code. It never stores
passwords, hashes, tokens, cookies, or client secrets. Reruns reconcile by source
ObjectId plus manifest/run fingerprint; email is reconciliation input only after a
mapping exists.

## Go/no-go checklist

- [ ] hosting target supports the custom Node server and canonical proxy behavior
- [ ] secret inventory and signing-key rotation drill are approved
- [ ] provider indexes and exact clients/secrets have approved initialization plans
- [ ] Studio coexistence/mapping proof passes in isolation
- [ ] Studio-only migration scope explicitly excludes Fitness until its product exists
- [ ] read-only Studio inventory count is explained and accepted
- [ ] email collisions, invalid values, and credential exceptions are resolved
- [ ] role/capability and every Studio ObjectId reference path are reconciled
- [ ] legacy-session invalidation procedure is tested
- [ ] dry run, interruption resume, reconciliation, rollback, and backups pass
