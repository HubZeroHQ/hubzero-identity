# Phase 4 — OAuth 2.0 / OpenID Connect provider

Phase 4 adds the first standards-based SSO layer without modifying Studio or Fitness. The canonical production issuer is `https://auth.hubzero.in`; isolated tests use an explicit loopback issuer and separate MongoDB database.

## Topology

`server.ts` is the Node entry point. It prepares Next, sends `/authorize`, `/token`, `/jwks`, discovery, resume, and provider-owned routes to `oidc-provider`, and delegates Account UI plus `/interaction/:uid` to Next/Identity-owned handlers. The provider is enabled only when `OIDC_PROVIDER_ENABLED=true`. Production initialization is intentionally not performed by tests or application startup.

Provider-owned responses receive restrictive protocol headers and canonical-host checks. Native form navigations that Chromium reports with `Origin: null` are normalized only after the request host matches the configured Identity origin, allowing Next Server Actions to retain their own same-origin validation without accepting arbitrary forwarded origins.

## Protocol surface

The provider loads enabled first-party confidential web applications from `identity_applications`. Client secrets are resolved by an Identity-owned reference map (`OIDC_CLIENT_SECRETS_JSON`); plaintext secrets are not stored in application documents. Redirect URIs are exact. Authorization Code is the only grant, `client_secret_basic` is required, and PKCE S256 is mandatory. `openid profile email` are the only scopes. There is no public registration or generic consent UI.

The existing Identity session is authoritative. A missing session uses the existing sign-in flow, preserving the provider interaction through a short-lived HMAC-indexed continuation. A valid eligible session completes trusted first-party authorization directly, providing SSO across clients. Forced password change and membership checks remain server-side gates. A denied membership never receives a code or token.

## Persistence and tokens

Provider artifacts (`Interaction`, `Session`, `Grant`, `AuthorizationCode`, `AccessToken`) are stored in provider-owned `oidc_*_artifacts` collections with explicit TTL/index manifests. Authorization code consumption is a conditional MongoDB update; a concurrent second consumer receives an OAuth invalid-grant failure. Access tokens are opaque and short-lived. Refresh tokens, UserInfo, introspection, revocation, and RP-initiated logout are deliberately disabled; product logout therefore destroys only the product session, while HubZero sign-out revokes the Identity browser session.

Signing keys are supplied as an ES256 JWK set at startup. JWKS exposes public keys only, and previous public keys remain available during the configured token lifetime. Test keys and test clients are generated in isolated E2E setup. The deployment fails closed when enabled production key/client configuration is missing.

## Test clients and safety

The E2E suite creates two unmistakably non-production confidential clients on separate loopback origins, a fake internal account, explicit memberships, and a per-run ES256 key. Each test client validates state, nonce, issuer, audience, signature, expiry, and JWKS before creating its own session keyed by `issuer + sub`. Tests cover discovery/JWKS, SSO, membership denial, prompt-none, invalid redirect, code replay, and isolated MongoDB cleanup. No Studio/Fitness client, account, session, key, or legacy collection is touched.

## Production initialization still required

Before enabling the provider in production, operators must approve controlled index migration, load a production key set through secret management, register exact HTTPS clients and secret references, seed memberships, and verify health/readiness. None of those actions occur in Phase 4 tests.
