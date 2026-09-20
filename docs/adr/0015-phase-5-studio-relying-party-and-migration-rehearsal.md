# ADR 0015: Studio OIDC bridge and rehearsal-first migration

Status: accepted · Phase 5 · 2026-09-20

## Context

Studio's existing `users._id` is the live key for CMS authorship, assignment,
history, and capability evaluation. Its Auth.js Credentials flow and encrypted
JWT session remain operational until a separately authorized cutover. Phase 5
needs a real relying-party path without allowing email-based account linking,
creating a second Studio user, or making Identity a Studio-role authority.

The Phase 1 roadmap separately named membership operations, migration tooling,
and the Studio transition. The approved Phase 5 scope consolidates their
**rehearsal** work, while retaining the original prohibition on production
initialization and cutover.

## Decision

Studio receives an additive `identitySubject` field on its existing `users`
documents. A sparse unique index makes the mapping one-to-one. Studio retains
the ObjectId as its sole internal ownership, history, and authorization key.
The field is set only by a controlled migration command; no normal user form or
email lookup can write it.

Studio uses `openid-client` as its OIDC relying-party library. Its feature-
gated route performs Authorization Code + PKCE S256, state, nonce, exact issuer
and callback checks, discovery, client-secret Basic authentication, and ID-token
validation. A validated `sub` resolves through `users.identitySubject`, then
Studio re-reads its current user/role before creating its existing Auth.js JWT
product session.

The callback never sends an Identity token into React or turns it into a
long-lived Studio credential. It creates a 60-second, HMAC-addressed,
one-time MongoDB handoff record. An internal-only Auth.js Credentials provider
consumes the matching HttpOnly handoff cookie and emits the native Studio
session. The handoff cannot create a user or accept an arbitrary subject.

`STUDIO_AUTH_MODE` is the sole transition control:

- `legacy` is the default and exposes only legacy credentials;
- `dual` keeps legacy credentials authoritative and enables the isolated OIDC
  rehearsal route;
- `oidc` is reserved for the approved cutover and fails configuration validation
  unless all OIDC requirements are supplied.

Phase 5's migration command is intentionally read-only: it inventories a
sanitized operator export and produces a dry run. The later production apply
command must use an approved manifest, journal, explicit production gates, and
cross-database reconciliation rather than pretending the two databases share a
transaction.

## Alternatives considered

- Replacing Studio ObjectIds: rejected because it would rewrite live CMS and
  authorization references.
- Mapping by email at every callback: rejected because email is mutable and
  reconciliation-only.
- Adding a generic OAuth provider to Auth.js: rejected because its account
  linking semantics are email/account-adapter oriented and could create or link
  a Studio user outside the explicit mapping contract.
- Hand-encoding an Auth.js JWT: rejected because it would depend on an
  explicitly unstable internal token format.
- Leaving callback state in a query string or browser storage: rejected because
  state, nonce, and PKCE verifier need server-verifiable, HttpOnly handling.

## Consequences

Studio's existing legacy JWT behavior remains a coexistence risk until Phase 6
deliberately switches the product to the OIDC path; role updates must continue
using Studio's current session invalidation/reauthentication procedures during
that window. New OIDC sessions resolve the current Studio user at callback, but
no claim transfers Studio roles to Identity.

The production sparse mapping/handoff indexes require an approved Phase 6 index
migration. Fitness has no repository in the current workspace, so its client
contract is documented but an application-level rehearsal is a hard Phase 6
gate.
