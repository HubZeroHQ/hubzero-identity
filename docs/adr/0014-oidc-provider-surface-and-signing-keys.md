# ADR 0014: Narrow OIDC surface and signing-key lifecycle

Status: accepted · Phase 4 · 2026-09-19

## Context

HubZero's first consumers are trusted first-party server applications. The provider must establish interoperable SSO without exposing a broad public OAuth platform or putting product authorization into Identity tokens.

## Decision

Enable only OpenID Connect Authorization Code with confidential web clients, `client_secret_basic`, and mandatory PKCE S256. Supported scopes are `openid`, `profile`, and `email`; claims are limited to `sub`, `name`, `email`, and `email_verified`. The immutable public `hz_...` subject is the OIDC `sub`. Access tokens are opaque and short-lived (five minutes); ID tokens are ES256 JWTs with a five-minute lifetime. Refresh tokens, UserInfo, introspection, revocation, device flow, dynamic registration, PAR, request objects, resource indicators, CIBA, implicit/hybrid flows, and RP-initiated logout are disabled until a concrete requirement exists.

Trusted first-party clients do not receive a generic consent screen. The requesting application is shown through Identity-owned metadata and active application membership is checked before authorization. OAuth grants remain distinct from product membership.

Signing keys are an externally supplied JWK set (`OIDC_SIGNING_KEYSET_JSON`) loaded at provider startup from deployment secret management. Production requires a private ES256 P-256 key with `kid`; public JWKS output strips private members. Rotation publishes the active key and retains previous public verification keys for the maximum issued-token lifetime. Test keys are generated per isolated run and never enter production configuration. No private key is committed or stored in a client document.

Provider artifacts use a MongoDB adapter in the dedicated Identity database. Authorization codes are short-lived, client/redirect/PKCE-bound, and atomically consumed. OIDC adapter selectors are HMAC-derived rather than raw bearer values.

## Consequences

Products validate issuer, audience, signature, expiry, nonce, and state, then create product-owned sessions keyed by `issuer + sub`. Account suspension and membership revocation affect new authorization immediately; already issued opaque access tokens remain valid only until their short lifetime unless a future resource-server revocation contract is added. Formal OpenID certification is not claimed by this ADR.

