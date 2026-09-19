# HubZero Identity

HubZero Identity is the private identity provider behind the user-facing **HubZero Account**. It authenticates people; each HubZero product remains responsible for deciding whether that person may enter and what they may do.

Phase 1 establishes the architecture, contracts, security model, representative account UI, and implementation roadmap. It deliberately contains no production authentication or mocked authentication behavior.

## Local foundation

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The representative pages use clearly labeled development data and do not connect to MongoDB. See [`docs/architecture.md`](docs/architecture.md) before implementing authentication behavior.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

No production Studio database, credential, or identity data is used by this repository.
