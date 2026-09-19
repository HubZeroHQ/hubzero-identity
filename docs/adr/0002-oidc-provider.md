# ADR 0002: Use `oidc-provider` for OAuth/OIDC

Status: accepted with Phase 4 deployment spike · 2026-09-19

## Context

Identity must be a standards-based provider, not a custom approximation. Next.js and Auth.js are excellent relying-party/application tools but do not supply a complete authorization server.

## Decision

Adopt `oidc-provider` 9.12.2 in a Node.js runtime. Configure only first-party Authorization Code + S256 PKCE, OIDC discovery/JWKS, confidential clients, and HubZero-owned interaction pages. Revocation, refresh tokens, UserInfo, dynamic registration, and RP-initiated logout remain disabled until a concrete requirement exists. The provider is mounted by the Phase 4 custom Node entry and uses a persistent MongoDB adapter.

The library was not added in Phase 1 because no protocol endpoint was being implemented. Phase 4's deployment spike selected the custom entry after evaluating a separate provider process and App Router handlers.

## Alternatives considered

- Hand-built endpoints with JOSE libraries: rejected for protocol risk.
- Auth.js/NextAuth: a relying-party/session framework, not the required provider.
- External Ory/Keycloak/Auth0: capable, but adds service/operational or vendor surface disproportionate to current scope and weakens the single-product UI goal.
- Custom Next server immediately: possible, but Next documents optimization tradeoffs; defer until measured.

## Consequences

We inherit a mature protocol core but must own secure configuration, adapters, interactions, upgrades, conformance testing, key management, and deployment lifecycle. Domain contracts remain framework-independent.

Phase 4 completed the deployment spike: the custom Node entry topology is accepted in ADR 0013 and the concrete narrow protocol/key decisions are recorded in ADR 0014.

## Evidence

- `oidc-provider` repository and supported features: https://github.com/panva/node-oidc-provider
- Next.js custom-server guidance: https://nextjs.org/docs/app/guides/custom-server
