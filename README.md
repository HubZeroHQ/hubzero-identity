# HubZero Identity

HubZero Identity is the private identity provider behind the user-facing **HubZero Account**. It authenticates people; each HubZero product remains responsible for deciding whether that person may enter and what they may do.

Identity now includes the private HubZero Account lifecycle and a narrow
first-party OIDC provider. The canonical production issuer is
`https://auth.hubzero.in`; products receive the immutable `hz_...` subject and
create their own sessions. Production migration and Studio cutover remain
explicitly out of scope until their gated runbook is approved.

## Local development

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The local Node entry is retained for development and portable Docker rehearsal.
It mounts the same OIDC bridge that Vercel uses, while all security-sensitive
state remains in MongoDB. See [`docs/architecture.md`](docs/architecture.md)
and [`docs/vercel-deployment.md`](docs/vercel-deployment.md) before changing
authentication or deployment behavior.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

No production Studio database, credential, or identity data is used by this repository.
