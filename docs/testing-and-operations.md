# Testing and operational verification

## Test layers

Unit tests cover password validation/verification adapters, bcrypt-to-Argon2id migration decisions, session validity/rotation, authorization helpers, exact redirect matching, PKCE validation integration points, safe security-event construction, email normalization, and environment rules.

Integration tests use an isolated MongoDB and real provider adapter. They cover login/logout, fixation prevention, revoked/expired session, suspension, password-change invalidation, application disabled state, membership allow/deny, code exchange, redirect mismatch, wrong PKCE verifier, expired/reused code, refresh rotation/reuse, and concurrent single-use attempts.

End-to-end tests eventually run two small relying-party fixtures:

- Studio → Identity → callback → current Studio membership/role → allow or authorization denial.
- Fitness → Identity → callback → current Fitness membership → allow or authorization denial.

Keyboard-only, screen-reader semantics, reduced motion, mobile viewports, JS-disabled sign-in POST behavior, and cross-browser cookie behavior are release checks. Protocol conformance tests supplement, not replace, domain tests.

## Operational checks

Each release verifies install reproducibility, lint, types, tests, production build, secret scan, dependency audit, index plan, migration dry-run, backup/restore posture, and staging smoke tests. Authentication material is synthetic. No CI job receives production database access.
