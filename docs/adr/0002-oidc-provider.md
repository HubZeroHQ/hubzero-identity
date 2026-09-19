# ADR 0002: Use `oidc-provider` for OAuth/OIDC

Status: accepted with Phase 4 deployment spike · 2026-09-19

## Context

Identity must be a standards-based provider, not a custom approximation. Next.js and Auth.js are excellent relying-party/application tools but do not supply a complete authorization server.

## Decision

Adopt the actively maintained, OpenID-certified `oidc-provider` v9 line in a Node.js runtime. Configure only Authorization Code, S256 PKCE, OIDC, revocation, and required logout behavior. Implement MongoDB adapters and HubZero interaction pages. Pin and review the exact version in Phase 4.

The library is not added in Phase 1 because no protocol endpoint is being implemented. Phase 4 first proves same-origin deployment with normal Next routing or a custom server and records the final mount decision.

## Alternatives considered

- Hand-built endpoints with JOSE libraries: rejected for protocol risk.
- Auth.js/NextAuth: a relying-party/session framework, not the required provider.
- External Ory/Keycloak/Auth0: capable, but adds service/operational or vendor surface disproportionate to current scope and weakens the single-product UI goal.
- Custom Next server immediately: possible, but Next documents optimization tradeoffs; defer until measured.

## Consequences

We inherit a mature protocol core but must own secure configuration, adapters, interactions, upgrades, conformance testing, key management, and deployment lifecycle. Domain contracts remain framework-independent.

## Evidence

- `oidc-provider` repository and supported features: https://github.com/panva/node-oidc-provider
- Next.js custom-server guidance: https://nextjs.org/docs/app/guides/custom-server
