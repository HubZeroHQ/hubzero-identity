# ADR 0004: Opaque server-controlled browser sessions

Status: accepted · 2026-09-19

## Context

Studio's encrypted JWT carries role/disabled data that can remain stale. Identity needs individual and global revocation.

## Decision

Use a high-entropy opaque cookie whose keyed hash maps to a server-side session row. Validate account status and session version on use. Support per-row revocation, version-based global invalidation, 7-day idle and 30-day absolute limits, daily rotation, and rotation at authentication/security boundaries.

## Alternatives considered

- Long-lived self-contained session JWT: rejected because authorization and suspension become stale.
- Shared product/Identity sessions: rejected due to trust-boundary coupling.
- Very short JWT plus denylist: combines operational complexity with two sources of truth.

## Consequences

Every Identity request performs a fast server-side lookup. Products create separate sessions and must maintain their own revocation/authorization behavior.
