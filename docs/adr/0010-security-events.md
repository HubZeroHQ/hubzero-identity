# ADR 0010: Append-only security event ledger

Status: accepted · 2026-09-19

## Context

Provisioning, authentication, credential, session, membership, and privileged changes need durable accountability without leaking secrets.

## Decision

Write append-only security events in the security-relevant transaction where possible. Use typed event names, actor/target/application, outcome/reason, request ID, coarse network context, and allow-listed scalar metadata. Keep an initial 400-day online retention subject to review; use no automatic TTL in v1.

## Alternatives considered

- Application logs only: mutable/short-lived and difficult for user timelines.
- Event sourcing the entire identity domain: excessive complexity.
- Store raw request context: creates a credential and privacy leak.

## Consequences

Event writes are part of success semantics for privileged operations. Storage growth is monitored, metadata schema is governed, and access is tightly restricted.
