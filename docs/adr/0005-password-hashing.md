# ADR 0005: Argon2id with bcrypt migration compatibility

Status: accepted · 2026-09-19

## Context

Five Studio credentials are bcrypt cost 12 and must migrate without plaintext or forced reset. New credentials should use a memory-hard scheme.

## Decision

Use Argon2id for new/changed passwords, with 19 MiB memory, 2 iterations, parallelism 1 as the minimum baseline and benchmark upward for production latency/capacity. Import bcrypt hashes with cost/version metadata, observe bcrypt's 72-byte input limit for legacy verification, and atomically rehash to Argon2id after successful login. Keep `mustChangePassword` independent.

Accept 12+ character passwords/passphrases up to 1024 UTF-8 bytes, reject known-compromised values when infrastructure is selected, and impose no composition or scheduled-expiry rule.

## Alternatives considered

- Continue bcrypt: compatible but not memory-hard and has input-length hazards.
- Force resets: unnecessary operational and security cost.
- Scrypt/PBKDF2: viable fallbacks; no FIPS requirement currently justifies PBKDF2.

## Consequences

Two verifiers exist during migration and require downgrade tests. Runtime cost must be benchmarked. Hash libraries are security-critical dependencies.
