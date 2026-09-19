# Provisioning, administration, and recovery

## V1 provisioning

Use `npm run account:provision -- ... --password-stdin`, run by an authorized operator with a short-lived privileged database credential. The CLI requires name, email, actor subject, reason, and a 16+ character idempotency key; memberships are optional application IDs. Initial credentials default to `mustChangePassword=true`. It supports `--dry-run` and `--json`. It never accepts a password argument: stdin must come from an approved protected secret source, and the CLI refuses visible TTY entry.

Creation is transaction-backed and requires deployed indexes. The idempotency key is SHA-256 hashed before storage. A replay returns the same subject only when identity input and current active memberships remain compatible; it never changes the password, subject, status, or memberships. The output says whether creation occurred and contains only subject, canonical display email, and memberships. A different password on replay is intentionally ignored because replay never overwrites credentials. Canonical-email or incompatible-key conflicts fail and are audited.

The CLI's database credential authorizes execution; `--actor-subject` is mandatory attribution, not an authentication mechanism. Until a dedicated operator authentication path exists, runbook review must verify that attribution. Legacy migration accepts hashes only from a controlled export channel and remains Phase 6.

The account UI is self-service only. A narrow admin UI is deferred until operational frequency justifies it. When added, it requires explicit admin capability independent of `internal`, server-side checks, recent re-authentication for sensitive changes, and audited actor/target records.

## Recovery

Email recovery requires a verified delivery domain/provider, abuse controls, generic public responses, a cryptographically random token stored only as a hash, single use, short expiry (target 30 minutes), and session invalidation after completion. Recovery links are bound to the intended action and never reveal account existence. Security questions are prohibited.

Until email infrastructure and identity-proofing policy are ready, v1 uses a two-person internal recovery runbook through the audited CLI: verify the requester out of band using approved internal channels; one operator initiates and another approves; issue a short-lived one-time setup link through a separate channel; force password change; revoke all sessions; record actors and reason. The final mechanism must be threat-modeled before implementation. There is no insecure placeholder email form.
