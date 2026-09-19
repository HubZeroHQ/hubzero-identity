# Provisioning, administration, and recovery

## V1 provisioning

Use a reviewed, audited CLI and dedicated migration command, run by an authorized operator with a short-lived privileged database credential. This is the smallest safe mechanism for five accounts and avoids shipping a premature IAM console.

Commands will support dry-run, idempotency key, explicit operator subject, structured redacted result, and transaction-backed creation. Initial passwords are never command-line arguments or logged. Legacy migration accepts hashes only from a controlled export channel. Every provision, membership change, suspension, recovery, and session revocation writes a security event.

The account UI is self-service only. A narrow admin UI is deferred until operational frequency justifies it. When added, it requires explicit admin capability independent of `internal`, server-side checks, recent re-authentication for sensitive changes, and audited actor/target records.

## Recovery

Email recovery requires a verified delivery domain/provider, abuse controls, generic public responses, a cryptographically random token stored only as a hash, single use, short expiry (target 30 minutes), and session invalidation after completion. Recovery links are bound to the intended action and never reveal account existence. Security questions are prohibited.

Until email infrastructure and identity-proofing policy are ready, v1 uses a two-person internal recovery runbook through the audited CLI: verify the requester out of band using approved internal channels; one operator initiates and another approves; issue a short-lived one-time setup link through a separate channel; force password change; revoke all sessions; record actors and reason. The final mechanism must be threat-modeled before implementation. There is no insecure placeholder email form.
