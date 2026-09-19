# Testing and operational verification

## Test layers

Unit tests cover password validation/verification adapters, bcrypt-to-Argon2id migration decisions, session validity/rotation, authorization helpers, exact redirect matching, PKCE validation integration points, safe security-event construction, email normalization, and environment rules.

Integration tests use an isolated MongoDB and real provider adapter. They cover login/logout, fixation prevention, revoked/expired session, suspension, password-change invalidation, application disabled state, membership allow/deny, code exchange, redirect mismatch, wrong PKCE verifier, expired/reused code, refresh rotation/reuse, and concurrent single-use attempts. Provider protocol scenarios run in a separate isolated OIDC browser suite.

Phase 2 integration tests launch a uniquely named, digest-pinned MongoDB 8 Docker container as a single-node replica set, publish a random loopback-only port, and remove only that container in teardown. This reproduces transaction semantics without production/shared databases or a vulnerable harness dependency. `npm run test:integration` fails clearly when Docker is unavailable. Updating the image digest is a reviewed dependency change. Later provider scenarios remain Phase 4.

End-to-end tests eventually run two small relying-party fixtures:

- Studio → Identity → callback → current Studio membership/role → allow or authorization denial.
- Fitness → Identity → callback → current Fitness membership → allow or authorization denial.

Keyboard-only, screen-reader semantics, reduced motion, mobile viewports, JS-disabled sign-in POST behavior, and cross-browser cookie behavior are release checks. Protocol conformance tests supplement, not replace, domain tests.

Phase 3 adds a real Chromium browser suite. It starts a production-mode local Next server with an isolated Docker MongoDB replica set and only `@e2e.invalid` accounts. The command passes explicit test environment variables to the child process, so `.env.local` cannot become its runtime database. The suite exercises sign-in, generic errors, rate limiting, forced and voluntary password changes, account guards, session revocation/replacement/rotation, logout, and suspension.

Phase 4 adds an isolated OIDC browser suite. It starts the custom Node/Next provider with a per-run replica-set database, generated ES256 test key, fake internal account, and two confidential clients on separate loopback origins. It validates discovery/JWKS, exact callbacks, S256 PKCE, state/nonce, one-time code exchange/replay, membership denial, prompt-none, and SSO while each test client creates its own session. It never reads `.env.local`, initializes production OIDC collections, registers production clients, or contacts the legacy `hubzero` database.

## Operational checks

Each release verifies install reproducibility, lint, types, tests, production build, secret scan, dependency audit, index plan, migration dry-run, backup/restore posture, and staging smoke tests. Authentication material is synthetic. No CI job receives production database access.
