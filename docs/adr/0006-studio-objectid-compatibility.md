# ADR 0006: Preserve Studio ObjectIds through a mapping

Status: accepted · 2026-09-19

## Context

Studio ObjectIds are embedded in history, ownership, assignments, and live authorization. Replacing them at identity cutover risks data integrity.

## Decision

Studio retains every existing user record/ObjectId and owns a unique one-to-one mapping between Identity `sub` and legacy ObjectId. OIDC callback resolves `sub` through this mapping before Studio membership and current role/capability checks. Initial migration rewrites no CMS reference.

## Alternatives considered

- Reuse ObjectId as `sub`: couples the new issuer to Studio storage.
- Rewrite references: high-risk, unnecessary, and hard to roll back.
- Map by email on each login: mutable and unsafe.

## Consequences

The mapping becomes migration-critical data with uniqueness and reconciliation requirements. Studio schema cleanup is a separate future project, not an Identity prerequisite.
