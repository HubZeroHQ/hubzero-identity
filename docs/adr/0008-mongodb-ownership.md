# ADR 0008: Dedicated MongoDB collections by security lifecycle

Status: accepted · 2026-09-19

## Context

Identity must not repurpose Studio's `users` collection. Credentials, sessions, protocol artifacts, and audit records have distinct access and retention needs.

## Decision

Use a dedicated database and collections for users, credentials, sessions, applications, memberships, authorization codes, refresh tokens, and security events. Normalize at security/lifecycle boundaries. Enforce uniqueness and TTL in MongoDB indexes.

## Alternatives considered

- One user aggregate: creates unbounded session/audit documents and over-broad read access.
- Collection per tiny concept: increases transactional and operational overhead without benefit.
- SQL: valid, but MongoDB matches the preferred stack and team context; no relational requirement outweighs migration cost now.

## Consequences

Cross-collection transactions are reserved for provisioning/security-sensitive mutations. Database roles and backups cover Identity independently of Studio.
