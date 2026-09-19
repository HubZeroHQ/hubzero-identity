# ADR 0003: Opaque prefixed ULID subject

Status: accepted · 2026-09-19

## Context

OIDC `sub` must survive email/profile changes, avoid leaking MongoDB topology, and never be reassigned.

## Decision

Generate a random monotonic-capable ULID and serialize it as `hz_<26 uppercase Crockford characters>`. Treat it as an opaque string externally. It is immutable and globally unique within the issuer; deleted subjects are never reused.

## Alternatives considered

- Email: mutable and personally identifying.
- MongoDB ObjectId: exposes storage choice and collides conceptually with Studio's legacy ID.
- UUIDv4: secure and valid, but less operationally sortable; still acceptable if ULID library quality becomes a concern.

## Consequences

Generation needs a vetted library and a unique database index. Prefixing improves log/schema recognition without encoding account type or authorization.
