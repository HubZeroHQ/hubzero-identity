# ADR 0016: Vercel is the primary Identity deployment target

Status: accepted · Phase 6B · 2026-09-20

## Context

Phase 4 used a portable custom Node listener and Docker image to mount
`oidc-provider` next to the Next.js Account application. Phase 5 considered a
long-lived Docker/App Platform deployment but did not select a host. Identity
must retain one canonical issuer, `https://auth.hubzero.in`, durable MongoDB
state, Node-compatible `oidc-provider` execution, explicit secrets, health
endpoints, and a safe rollback path.

Current Vercel documentation supports Node.js Functions, Fluid Compute,
environment variables, deployment logs, custom domains, and MongoDB pool
attachment. Its framework-native deployment model does not run a repository
root listener. Next.js also treats a custom server as an ejection path.

## Options considered

1. Keep Docker/custom-server hosting as primary. It remains portable but adds
   container, proxy, patching, and process-operation work for this small
   service.
2. Use Vercel with one fixed Node Function adapter per canonical OIDC,
   interaction, and health route, while Next serves Account routes. This keeps
   one public origin without depending on a long-lived listener.
3. Split Account and provider across origins. This would alter the issuer and
   session/interactions architecture without a demonstrated need.

## Decision

Use Vercel as the primary production target. Internal rewrites send canonical
protocol paths to Node 22 Functions, which reconstruct the canonical path and
invoke the same Node-native provider bridge used by `server.ts`. `server.ts`
and `dist/server.mjs` remain a portable Docker/local fallback, not a Vercel
entrypoint.

`IDENTITY_ISSUER_URL` remains fixed configuration, never a Vercel deployment
host or `VERCEL_URL`. Preview deployments disable OIDC unless a future,
explicit isolated protocol environment is configured. MongoDB remains the
authority for every cross-request security artifact.

## Consequences

Vercel project environments must contain the production secret contract and
must be redeployed after a signing-key change. Canonical-domain DNS/TLS,
public-access policy, isolated end-to-end rehearsal, key-overlap rotation, and
rollback are still required Phase 6B evidence; this ADR does not authorize
production initialization or migration. Docker stays maintained only as a
portable fallback.
