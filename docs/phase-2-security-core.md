# Phase 2 security core implementation record

## Passwords

`argon2` 0.45 implements Argon2id v19 at 19,456 KiB, time cost 2, parallelism 1, and 32-byte output. On 2026-09-19, Node 22.14/Windows development hardware produced five hashes in 17–19 ms (median 17 ms, mean 18 ms). This is a development observation, not permission to reduce parameters; production must benchmark concurrency and memory pressure before release.

`bcrypt` 6 verifies imported `$2a$`/`$2b$` hashes and parses the encoded cost instead of assuming 12. Metadata must match the encoded hash. Legacy verification rejects password inputs over 72 UTF-8 bytes rather than silently truncating. A successful verification computes Argon2id, then transactionally compare-and-sets the old bcrypt record and writes `password.legacy_migrated`. A racing loser verifies the winning Argon2id result.

New passwords require 12 Unicode characters and at most 1024 UTF-8 bytes, with no composition or periodic-expiry rule. Compromised-password screening remains blocked on selection of a privacy-preserving provider/local corpus and must be added before public exposure.

## Sessions

Session bearer material contains a non-secret `ses_` ULID and 256 random bits. Only a domain-separated HMAC-SHA-256 value is stored. The production cookie is `__Host-hz_session`, HttpOnly, Secure, SameSite=Lax, path `/`, no Domain, and a 30-day maximum. Idle lifetime is 7 days, absolute lifetime 30 days, rotation age 24 hours, prior-secret concurrency grace 2 minutes.

## Atomicity and audit

See ADR 0011. Required-audit operations do not succeed without their event. TTL indexes are cleanup and never replace application expiry checks. Index migration preflights the complete manifest and performs no destructive replacement.

## Operational limitations

- HMAC key rotation needs a versioned dual-read migration before changing either environment key.
- The CLI actor is operator-supplied attribution protected by execution controls, not cryptographic operator authentication.
- Fixed windows can burst at boundaries; current private scale accepts this tradeoff.
- Docker is required for the integration suite; no production/shared database is permitted.
