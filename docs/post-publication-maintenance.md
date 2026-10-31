# Post-publication maintenance

Dependency and repository-safeguard decisions recorded after the repository was
published. Nothing here changes authentication behavior or architecture.

## Dependency remediation

`npm audit` moved from 27 findings (1 critical, 8 high, 18 moderate) to 16
moderate findings. The production dependency tree (`npm audit --omit=dev`) has
no findings.

| Package | From | To | Reason |
| --- | --- | --- | --- |
| `next` | 16.3.5 | 16.4.3 | Advisories affecting every release through 16.4.0, including `GHSA-2464-fhr4-w9xw`, `GHSA-673q-mjm6-r5xr`, `GHSA-p3m5-59mp-jv5r` and `GHSA-cjq9-62q9-8jv4`. No 16.3 release is patched. |
| `eslint-config-next` | 16.3.5 | 16.4.3 | Kept in step with `next`. |
| `zod` | 4.6.5 | 4.6.7 | `GHSA-mrhx-c7xc-m3w5`. |
| `sharp` | 0.35.4 | 0.35.5 | `GHSA-wq5f-xc86-pv6w`; follows the `next` update. |
| `vitest`, `@vitest/mocker` | 5.0.1 | 5.0.5 | `GHSA-qxg6-89mg-rqv8`, `GHSA-xp26-3454-mjgp`. Test only. |
| `vite` | 8.3.0 | 8.3.5 | Advisories through 8.3.2. Test only. |
| `undici` | 7.29.1 | 7.30.1 | Advisories below 7.30.1, reached only through `jsdom`. Test only. |
| `source-map-js` | 1.2.1 | 1.2.2 | `GHSA-68fv-2mgg-jv7q`. Build and test tooling. |

### `zod` override

`@vercel/cli-config` pins `zod` to exactly 4.1.11, and it is reached through
`@vercel/functions` → `@vercel/oidc`. The newest `@vercel/cli-config` keeps that
pin, so upgrading `@vercel/functions` would move `@vercel/oidc` a major version
without resolving anything. The override in `package.json` applies to that one
path and resolves it to the project's own `zod`.

Remove the override once `@vercel/cli-config` no longer pins a vulnerable
release.

### Accepted findings

The 16 remaining moderate findings are all one advisory,
`GHSA-g3hv-75wg-m249` (`minimatch` below 11.0.1), repeated through the packages
that depend on it: ESLint, `eslint-config-next` and their plugins. It affects
development tooling only and needs a hostile glob pattern; linting runs on this
repository's own configuration. ESLint 9 relies on the `minimatch` 3 API, so
forcing version 11 through an override is not a compatible change. Revisit it
when ESLint moves to a patched `minimatch`.

The `fixAvailable` suggestions of `eslint@4.0.0`, `eslint-config-next@12.0.4` and
`@vercel/functions@3.6.1` are downgrades and must not be applied. Do not run
`npm audit fix --force` here.

## Repository safeguards

`.gitignore` now also covers private keys, database exports, local backups and
archives, and further test output. These rules do not protect a file that is
already tracked, and no tracked file matches them.

Run a full-history secret scan before changing what is published:

```sh
gitleaks git . --log-opts="--all" --redact
```

Integration and E2E tests start Next servers that load local environment files.
Run them from a clean clone with no `.env*` files, so a local configuration
cannot reach a test server.
