# ADR 0001: Separate identity from product authorization

Status: accepted · 2026-09-19

## Context

A HubZero Account proves who a person is. Studio and Fitness have independent access lifecycles, and Studio roles directly protect CMS operations.

## Decision

Identity issues a stable subject and owns explicit application-level membership. Each product enforces that membership and owns roles/capabilities. Authentication success is not authorization success.

## Alternatives considered

- Account existence or `internal` grants all products: rejected as implicit privilege.
- Centralize every product role in Identity: rejected because it couples product policy and creates stale token claims.
- Let products alone store membership: viable later, but a small canonical association is needed for provisioning and the Applications UI.

## Consequences

Products require a post-login authorization lookup and denial UI. Revocation remains current without reissuing identity tokens. Cross-system contracts must be tested.
