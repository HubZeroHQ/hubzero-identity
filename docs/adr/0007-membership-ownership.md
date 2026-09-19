# ADR 0007: Central application membership, product-owned roles

Status: accepted · 2026-09-19

## Context

The account surface should show associated products and operators need explicit access grants, but product roles evolve with product behavior.

## Decision

Identity owns one status-bearing membership per subject/application. Products enforce it and own roles/capabilities. Membership records contain no generic `role` field in v1. Role display, if needed, comes from an explicit product contract.

## Alternatives considered

- Put optional role strings in Identity: simple initially but creates ambiguous authority and stale policy.
- Keep all membership only in products: clean decentralization but complicates controlled provisioning and user-visible associations at current scale.

## Consequences

Membership revocation requires prompt product propagation/checking. Provisioning coordinates Identity membership and product records with reconciliation rather than assuming a distributed transaction.
