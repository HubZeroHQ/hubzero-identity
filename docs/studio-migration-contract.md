# Studio migration contract

Status: binding design contract; no production migration is authorized by Phase 1.

## Invariants

The future migration will:

1. preserve all five in-scope Studio identities after a fresh source inventory;
2. assign each an immutable Identity subject and preserve a unique mapping to the exact legacy Studio ObjectId;
3. preserve name, email, image where valid, disabled state, `mustChangePassword`, timestamps where meaningful, and current Studio role;
4. import existing bcrypt hashes without plaintext access and record algorithm/version/cost metadata;
5. allow compatible passwords to continue working, then upgrade bcrypt to Argon2id after successful verification without clearing `mustChangePassword` accidentally;
6. leave all CMS ownership, history, assignment, media, version, editorial, note, and team references unchanged at initial migration;
7. keep Studio role and capability authority in Studio;
8. create explicit Studio and Fitness memberships only from an approved per-person manifest—never from `internal` account type;
9. intentionally invalidate all legacy Studio sessions at final cutover and require OIDC reauthentication;
10. retain legacy credential data read-only until cutover acceptance and rollback windows close; cleanup requires a separate approved operation.

## Migration procedure contract

1. Read-only inventory emits counts, ObjectIds, normalized-email collision report, hash algorithm/cost, missing hashes, invalid roles, disabled flags, `mustChangePassword`, and reference-integrity summary. Output containing hashes is encrypted/restricted and never logged.
2. An operator-approved manifest maps each source ObjectId to proposed subject, memberships, and expected Studio role. Two reviewers approve production input.
3. Dry-run validates target uniqueness/indexes, source snapshot identity, supported bcrypt format, and exact reconciliation totals.
4. Import writes Identity users/credentials/memberships/audit records idempotently and produces a signed/checksummed reconciliation artifact. Studio mapping/role changes follow Studio's controlled migration.
5. Reconciliation proves one-to-one subject/ObjectId mapping, field equality, credential counts, memberships, and zero rewritten CMS references.
6. Cutover invalidates legacy sessions, enables Studio OIDC behind the prepared transition control, and monitors login plus authorization denial outcomes.
7. Rollback disables the new relying-party route, restores legacy authentication within the agreed window, and leaves additive Identity data quarantined for investigation. It does not guess at destructive reversal.

## Facts to verify immediately before production work

- exact production database/collection and all five source ObjectIds
- normalized email uniqueness and verification truth
- bcrypt prefixes/costs and whether any password exceeds bcrypt's 72-byte limit
- complete disabled and `mustChangePassword` semantics in every login path
- current role values and capability derivation
- all ObjectId/string reference shapes and indexes, especially Team mappings
- current session population and reliable invalidation mechanism
- production callback/origin URLs, proxy/TLS topology, backup/restore test, and change window
- owner-approved Studio/Fitness membership matrix per person
- rollback duration and acceptance criteria for deleting legacy hashes
