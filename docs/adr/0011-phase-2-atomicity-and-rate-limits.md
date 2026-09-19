# ADR 0011: MongoDB atomicity boundaries for the security core

Status: accepted · 2026-09-19

## Context

Phase 2 needs durable audit coupling, concurrency-safe provisioning and credential migration, revocable sessions, and a shared limiter. Current private scale does not justify Redis, but process-local state is incorrect. MongoDB transactions require a replica set.

## Decision

Use MongoDB according to invariant size:

- multi-document transactions for provisioning plus audit, session/security state plus required audit, suspension/restoration, and bcrypt upgrade plus audit;
- unique indexes for subject, canonical email, credential ownership, membership, and provisioning idempotency;
- compare-and-set for bcrypt replacement and session-secret rotation;
- atomic aggregation-pipeline updates for fixed-window rate buckets;
- an isolated MongoDB 8 single-node replica set in integration tests.

Rate-limit keys use a separate HMAC key and namespace domain separation. MongoDB is behind the narrow `RateLimiter` interface. Security-sensitive callers fail closed on storage errors; any fail-open use must be explicit and non-authenticating.

## Alternatives considered

- Process-local maps: rejected because instances diverge and restarts erase limits.
- Redis immediately: correct but adds infrastructure disproportionate to five private users.
- Best-effort audit after state changes: rejected because privileged operations could silently lose accountability.
- Standalone/mocked MongoDB tests: rejected because they cannot prove transaction behavior.

## Consequences

Development, tests, staging, and production must provide replica-set transaction support. Rate-limit writes add MongoDB load and fixed windows permit boundary bursts; monitor before external scale. Moving the limiter later does not change callers. Transaction unavailability is a deployment failure, not a signal to weaken audit semantics.
