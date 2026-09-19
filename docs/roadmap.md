# Implementation roadmap

## Phase 1 — foundation (this repository state)

Architecture, threat model, domain contracts, index definitions, environment contract, design system, representative UI, ADRs, migration contract, tests, and build/tooling baseline.

## Phase 2 — identity security core

Implemented on `phase-2/security-core`: controlled MongoDB indexes and typed collections; normalization v1; Argon2id plus atomic bcrypt upgrade; opaque session lifecycle; durable typed security events; MongoDB rate limiter; audited provisioning CLI; and real replica-set integration tests. No OIDC endpoints or production migration.

## Phase 3 — account authentication surface

Implemented on `phase-3/auth-lifecycle`: real credential sign-in/out, guarded HubZero Account pages, forced and voluntary password change, profile name edits, session management and revocation, membership display, same-origin mutation checks, CSP/host protections, and isolated real-browser tests. OAuth/OIDC remains deferred.

## Phase 4 — standards provider

Complete the deployment spike, integrate `oidc-provider` with MongoDB adapters and HubZero interactions, configure Authorization Code + S256 PKCE, discovery/JWKS/key rotation, claims, token/refresh lifecycle, logout, conformance tests, and register non-production clients.

## Phase 5 — membership operations

Implement membership enforcement contracts, audited CLI operations, application management seeding, and only the smallest admin surface proven necessary. Add product-facing denial states and revocation propagation.

## Phase 6 — Studio migration tooling

Build read-only inventory, deterministic dry-run, reconciliation reports, transactional import, bcrypt metadata import, `mustChangePassword`, status and role preservation, subject/ObjectId mapping export, rollback artifacts, and synthetic rehearsal.

## Phase 7 — Studio relying-party transition

Integrate OIDC in Studio behind a controlled flag. Resolve subject to legacy ObjectId, fetch current Studio role/capabilities, test denial and stale-authorization paths, and rehearse rollback. Do not rewrite CMS references.

## Phase 8 — production cutover

Verify the five current records and product memberships, freeze conflicting identity mutations, run import, reconcile, explicitly invalidate legacy sessions, enable Studio/Fitness relying parties, and monitor with rollback window.

## Phase 9 — legacy credential retirement

After acceptance criteria and retention window are met, remove Studio credential authentication and then delete legacy credential material through an approved, recoverable plan. Preserve Studio users/ObjectIds and product authorization data.

## Phase 10 — recovery, hardening, and v1

Enable validated recovery delivery, exercise key/secret rotation and incident runbooks, complete accessibility/protocol/security testing, deployment verification, documentation, and v1 readiness review.

Each phase has an explicit entry/exit review. Future passkeys, MFA, recovery codes, external providers, public registration, and broad IAM administration remain outside v1.
