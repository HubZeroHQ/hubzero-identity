# ADR 0013: OIDC provider deployment topology

Status: accepted · Phase 4 · 2026-09-19

## Context

HubZero Identity already ships a Next.js 16 App Router account application. OIDC must use the canonical issuer `https://auth.hubzero.in`, share the Identity browser session, and run on Node because MongoDB, signing keys, and `oidc-provider` are not Edge-compatible.

## Options considered

1. Keep `next start` and add an independently deployed provider service behind a reverse proxy. This gives a clean process boundary, but requires deployment-specific routing, shared interaction/session assumptions, and a second lifecycle before the provider is proven.
2. Mount `oidc-provider` in a custom Node entry and delegate non-protocol requests to Next. This keeps one origin, one release unit, shared runtime/database access, and a small interaction boundary.
3. Implement OAuth/OIDC inside App Router route handlers. This would duplicate a security-sensitive protocol implementation and is rejected.

## Decision

Use a small custom Node entry (`server.ts`) that prepares Next and routes protocol endpoints to `oidc-provider`. Next handles Account UI, sign-in, and the Identity-owned interaction page. The provider owns standard protocol parsing, PKCE, codes, tokens, discovery, and JWKS; the entry point performs only host/session/membership prechecks and delegates the provider callback.

The deployment must run the Node runtime, preserve the canonical host, and provide the same dedicated MongoDB database to both components. `next start` remains available conceptually as a rollback shape, but Phase 4's `dev`/`start` scripts use the custom entry. Next standalone output is not used because it cannot trace a custom server entry; the lost automatic static optimization is acceptable for this private, dynamically rendered authentication surface.

## Consequences

Development/test enable the provider explicitly and use isolated issuers, keys, clients, and databases. Production remains disabled until signing keys, client secret references, indexes, and applications are initialized through an approved rollout. Health readiness reports provider availability without exposing configuration. A future separate provider process remains possible behind a trusted deployment proxy, but is not required to prove Phase 4.

