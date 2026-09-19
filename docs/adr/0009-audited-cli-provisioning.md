# ADR 0009: Audited CLI-first provisioning

Status: accepted · 2026-09-19

## Context

V1 has five internal accounts and no public registration. A large administration application would increase attack surface before its workflow is known.

## Decision

Build an idempotent, dry-run-capable audited CLI in Phase 2/6 for account provisioning, migration, membership, suspension, and internal recovery. Use short-lived operator credentials and explicit actor/reason fields. Defer an admin UI until recurring operational needs are demonstrated.

## Alternatives considered

- Public/self registration: outside product scope.
- Full admin console: disproportionate attack and maintenance surface.
- Direct database edits: unaudited and error-prone.

## Consequences

Operators need a runbook and protected execution environment. CLI ergonomics and two-person recovery controls matter. A future UI can call the same domain commands.
