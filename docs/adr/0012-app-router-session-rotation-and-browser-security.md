# ADR 0012: App Router session rotation and browser security

Status: accepted · Phase 3 · 2026-09-19

## Context

Identity sessions are opaque server-controlled bearer credentials. Phase 2 permits daily rotation, but App Router Server Components may read cookies and cannot mutate them during rendering. Account mutations also need a clear same-origin boundary, and Identity needs a CSP that works with Next.js runtime scripts without weakening production policy.

## Decision

Use one server-side session resolver for all account routes. It validates the HttpOnly cookie with rotation deferred and returns only narrow account/session context to Server Components. When a session is rotation-eligible, a tiny client boundary POSTs to `/internal/session/refresh`; the route handler validates and rotates through the existing SessionService and updates the HttpOnly cookie. React never receives the bearer credential.

Use Server Actions for normal account mutations. Every action independently checks the configured issuer origin before reading identity/session state. Return destinations are accepted only as same-origin relative paths.

Use a nonce-bearing CSP in production through Next 16 `src/proxy.ts`, with `script-src` nonce plus `strict-dynamic`, nonce-bound styles, no framing, no objects, exact form actions, and no third-party sources. Account routes are intentionally dynamically rendered. Development uses the smaller Next-required CSP exception (`unsafe-eval` for the runtime and inline styles for development tooling); it is not present in production.

## Alternatives considered

- Rotating during Server Component rendering: the database record could rotate without a way to deliver the replacement cookie.
- A second browser-side auth store: duplicates Identity session authority and exposes unnecessary state to JavaScript.
- Auth.js: creates a parallel session system for Identity's own issuer.
- A static CSP with `unsafe-inline`: simpler, but unnecessarily weak for the production authentication surface.
- An arbitrary forwarded-host trust model: allows reverse-proxy/header mistakes to affect security decisions.

## Consequences

The refresh route is an internal Identity endpoint, not an OAuth endpoint. It is same-origin POST-only and emits no bearer material in its response. Session activity writes are throttled to once every five minutes; idle expiry is conservatively evaluated from persisted activity.

Production deployment must preserve the canonical `Host` header for `auth.hubzero.in`; unknown production hosts receive 421. The nonce strategy makes Account pages dynamic, which is an intentional security/performance trade-off for a private account surface.
