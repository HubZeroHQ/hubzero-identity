# Phase 8 — Identity product quality

Status: **COMPLETE — Identity product polish accepted**, 26 September 2026.
Phase 7 remains accepted. Final authenticated production smoke and the additional
short-desktop sidebar correction are verified. No authentication redesign.

## Boundaries

OIDC-only Studio, immutable subjects/ObjectIds, product-owned authorization,
independent sessions and all protocol protections remain unchanged. No migration,
role changes, session invalidation, password changes or Fitness configuration.
Deployments are authorized; Git pushes are not.

## Brand and design

Canonical source: sibling HubZero repository, accepted commit 03f0a4c,
`public/brand/hubzero-logo-black.svg`, `hubzero-app-icon.png` and
`src/app/favicon.ico`. Identity vendors exact asset snapshots so independent
deployment does not require the sibling checkout or an external asset request.
The 2.4 KB vector mark is inverted for dark surfaces without redrawing geometry.
Future brand updates must update these snapshots from the canonical source.

Instrument Sans UI, Instrument Serif editorial accent and IBM Plex Mono metadata
match the main product. Palette: #0d0d0d, #141414, #ffffff, #cccccc, #a3a3a3 and
functional amber #e8ab5c; green/red reserved for actual status. Ruled sections,
compact forms, a desktop account rail and two-row mobile navigation replace the
crowded floating header. No new UI framework or state library.

Removed the production design-preview banner, fabricated denial-page identity
and inert preview form. Product rows show actual membership/application state;
unavailable memberships do not acquire a launch action. No unsupported MFA,
recovery, removal or email-edit controls are introduced.

## Performance baseline — 26 September 2026

Playwright Chromium, 1440×900, fresh contexts, production Studio explicit action
to Identity password-field visibility plus working reveal control. No real login.
Times measured on the same local connection. The first sample is *first observed*,
not a proven forced cold start.

| Stage (TTFB ms) | First observed | Warm 1 | Warm 2 |
| --- | ---: | ---: | ---: |
| Studio OIDC start | 3800 | 361 | 295 |
| Identity authorize | 3542 | 619 | 612 |
| Identity interaction | 3864 | 796 | 812 |
| Identity authorization UI redirect | 284 | 241 | 246 |
| Identity sign-in | 247 | 244 | 252 |
| Click → usable sign-in (elapsed) | 12358 | 2648 | 2693 |

Vercel deployment inspection confirms all Identity functions in iad1. Atlas UI
was independently inspected during this phase: hubzero-prod, AWS Mumbai
(ap-south-1), three-node replica set, MongoDB 8.0.32, free tier.

Diagnosed waste: an anonymous interaction persisted its continuation then
redirected through a database-backed account page merely to redirect to sign-in;
sign-in initialized the Mongo runtime before checking whether a session cookie
existed. Both are removed without skipping authenticated validation.

MongoClient and OIDC provider are already cached per instance; password-native
modules are already lazy. Do not claim to have fixed these existing protections.
New bounded timing records contain route class/status/durations/command counts
only, never URLs, query parameters, identifiers, documents or credentials.

Controlled regional comparison used the same UI/fast-path implementation:
iad1 warm elapsed samples were 2466, 2582 and 2120 ms; bom1 samples were
778 and 973 ms (first observed 2310 ms). All Identity functions were verified
in bom1; Studio's region was not changed. This supports database distance as a
material bottleneck, not a claim that every millisecond was Mongo execution.

Initial timing-enabled deployed measurement: first observed 3595 ms, then 797 and 842 ms warm.
Warm mean improved from 2670.5 to 819.5 ms, approximately **69%**. Samples are
small and are not a latency SLA. No forced cold-start experiment was performed.
Anonymous final authorization used two Mongo operations totaling 7 ms; interaction
used three totaling 11–13 ms. Newly initialized instances reported Mongo connect
131–132 ms and provider initialization 157–159 ms. These nested timings overlap;
do not add them as independent wall-clock stages.

Direct warm sign-in: TTFB 32 ms, DOMContentLoaded 294 ms, load 381 ms. Five
self-hosted font/subset resources totaled 82,240 transfer bytes; no external
resource requests. Existing next/font swap behavior and canonical font families
are retained. Native password dependencies remain lazy; no claim of a new fix.

Bounded `Server-Timing` metrics and structured timing logs use fixed phase names,
durations and operation counts, never request parameters or database documents.
First-request latency and shared-tier variability remain non-blocking monitoring
items; warm performance has materially improved without keep-warm traffic.

The final accessibility deployment was reprofiled: 1096 ms first observed in
that sample, then **714 and 679 ms** warm (mean 696.5 ms, approximately **74%**
below the original warm mean). Warm TTFBs were Studio start 292/273 ms,
authorize 52/55 ms, interaction 80/50 ms and sign-in 96/60 ms. This final sample
was after authenticated-page checks and is not evidence of a forced cold start.

## Verification

- Identity: lint/typecheck PASS; 55 unit (16 files), 25 Mongo integration (3 files), 11 browser/OIDC (2 files)
  tests PASS; Next and portable builds PASS; Argon2 runtime PASS; audit 0.
- Browser suite includes ten required widths for sign-in and five authenticated
  routes, real isolated database/session data, single H1/navigation, no horizontal
  overflow, preview-copy absence and keyboard skip-link checks.
- Existing browser lifecycle covers login, password change, session rotation,
  revocation and suspension. OIDC suite covers PKCE/token validation/SSO/code
  replay and stale tab/Back/refresh/duplicate continuation (safe 400).
- Studio initial verification: 807 tests PASS, lint/typecheck/build PASS.
  Audit retains the already recorded 3 moderate PostCSS dependency findings,
  0 high/critical. No forced Next major upgrade during auth presentation work.

## Visual and accessibility evidence

Actual isolated applications were inspected, not static mockups. Sixty Identity
screenshots cover sign-in, Account, Profile, Security, Sessions and Applications
at 320/360/375/390/430/768/1024/1280/1440/1920. Ten Studio login screenshots cover
the same widths. Screenshots contain synthetic fixture data and are outside Git.
Desktop/mobile and intermediate Account layouts were visually reviewed against
the live HubZero site. Canonical marks, ruled sections, readable labels and
intentional narrow-screen navigation replace the previous disconnected surfaces.

Axe WCAG 2 A/AA and 2.1 AA found zero violations on all six Identity surfaces at
390 and 1440. Single H1, semantic navigation, no horizontal overflow, keyboard
skip link and reduced-motion contexts pass. Studio production checks at
320/390/640/1024/1440 pass; axe at 390/1440 reports zero violations. The 640 CSS
viewport checks 1280-at-200% equivalent reflow. Additional 200% CSS rendered-zoom
checks pass for all five account routes, including a corrected Profile grid.
Native browser-window zoom automation was unavailable (native pipe absent), so
these are explicit rendered-zoom/reflow checks, not a claim of native OS testing.
Keyboard skip-link activation now focuses the content landmark and is asserted.

The operator reported clipped sidebar Sign out on short desktop screens. This
was reproduced at 1280×500 (button bottom 531, outside viewport). The sticky
rail now compacts its spacing at short heights and scrolls when necessary.
Final production button bottoms: 580 at height 600, 480 at height 500, 443 at
height 450; at height 320 it is fully reachable by rail scrolling (bottom 300).
Real-browser regression assertions cover all four heights.

Production invalid-interaction GET was tested without a real account: HTTP 400,
static safe recovery page, no internal identifiers, no horizontal overflow and
zero axe violations at 390. No state was recreated. Production sign-in has no
preview/demo labels; source audit finds those strings only in regression tests.

## Deployment and bounded production checks

- Final Identity deployment: `dpl_7xCiT5dn3yjaQ7YRQUmaoGyvVrUa`
  READY and aliased to `https://auth.hubzero.in`; remote build and post-deploy
  live/ready/discovery/JWKS checks PASS.
- Measured Identity runtime: `dpl_6DWSKEM4kMzsiNc7tFhi3oeDS1PT`, READY, bom1.
  Final copy-only revision does not change the measured runtime path.
- Studio: `dpl_DHWR4qKthQdLsiZGTvg1Dta8qFAq`, READY, `https://hubzero.in`.
- Identity live 204, ready 200, discovery 200, JWKS 200; exact canonical issuer
  and advertised endpoints, one public key, no private JWK fields.
- Read-only checks: 5 Identity users, 5 credentials, 5 active memberships,
  15 journal checkpoints, 5 Studio users, 5 mappings, 0 Fitness clients.
  Studio ObjectIds/mappings/roles/disabled/authVersion equal the starting snapshot.
- Bounded log review: 48 Identity records (17 HTTP 200, 5 HTTP 204, 26 HTTP 303),
  including 26 timing records; 100 Studio records (70 HTTP 200, 30 HTTP 307).
  No unexpected 5xx or detected configured-secret, URI, hash, JWT or private-key
  leakage. The deliberate stale-path 400 occurred after this sample.
- Tracked/current-secret scan: no real findings in either repository. Studio's
  existing fake cache-scope URI fixture was independently reviewed and excluded.

## Authenticated production acceptance

A brand-new temporary browser context started with zero cookies, opened the
OIDC-only Studio login (zero password inputs) and reached canonical Identity
sign-in. The operator entered credentials directly; no password was read,
requested in text, captured, logged or persisted. The browser reached Account
with an Identity session and no Studio session. A new explicit Studio action
then reused Identity SSO and completed authorize → interaction → callback →
finalize → dashboard. A NEW Auth.js session was present; `/api/auth/session`
resolved the exact original Studio ObjectId, headAdmin role and current authVersion.

Protected Profile, user administration, Work and Team routes passed. A Work
record's stored BSON creator reference matched the original Studio ObjectId and
its protected detail page was accessible. No product data was edited. Current
Studio user/mapping/role/disabled/authVersion snapshots remain identical.

Account, Profile, Security, Sessions and Applications were checked with the real
production session at 390/640/1440: one H1, no horizontal overflow or preview
copy, zero axe violations at 390/1440. The final sidebar and zoom fixes were
visually rechecked on production with identifying screenshot regions masked.

Session regressions:
- Identity-only cookies cannot authenticate Studio; Studio-only cookies redirect
  to Identity sign-in. The test waits for streamed navigation to complete.
- Identity cookie is host-only `__Host-hz_session`, Secure/HttpOnly/Lax/Path=/.
  Studio owns a separate Secure/HttpOnly/Lax Auth.js encrypted product cookie.
  No access/ID token is used as that browser session; exchange stays server-side.
- Studio logout removes only its product session. Account still recognizes the
  user; a subsequent Studio action reuses SSO without another password prompt.
- Identity logout removes its current session. The existing Studio session and
  protected profile remain valid; a future OIDC start requires Identity sign-in.
- Only newly created smoke-test sessions were signed out. No other user's
  sessions or authVersion were invalidated.

Post-login bounded logs also passed: 100 Identity HTTP 200 records and 35 Studio
records (34 HTTP 200, one HTTP 307), no detected secret leakage. Final health,
canonical issuer and safe stale-request HTTP 400 were independently rechecked.
The final 30-minute production 5xx query returned zero records for both projects.
Temporary smoke-test sessions and browsers were signed out/closed; read-only DB
connections were closed. Existing operator sessions outside the test context were
not touched. Both `.env.local` files remain ignored.

## Final refinements and regression coverage

`c527f0c` fixes content-width-aware Profile reflow, programmatic skip-link focus,
and the user-reported short-height sidebar. The first focus assertion ran before
streamed content was visible; its wait was corrected rather than changing auth.
Final lint/typecheck, 55 unit tests, 11 browser/OIDC tests and production build
PASS; prior 25 Mongo integration tests remain applicable (no later DB changes).
Portable build and secret scan PASS. Studio source remained unchanged during
this final refinement; its 807-test/build baseline remains valid.

The frontend-design and redesign-existing-projects guidance informed the canonical
brand reuse, editorial hierarchy and observed-layout iteration. No template auth
provider theme or fabricated account information was introduced.

## Rollback and retained material

Pre-polish Identity: `dpl_8Nh5Qos4BfWH5LQ616RzbR5TPV3H`.
Pre-polish accepted OIDC-only Studio: `dpl_BM2PDZNaEEQve2VGAnDcsUsQPUF9`.
Existing dual/legacy references remain in the Phase 7 record and Studio Phase 8
note. No auth-mode changes, account edits, mapping replacement, session mass
invalidation, CMS/Team writes, credential removal or Git pushes in this phase.

Non-blocking follow-up: monitor first-request/shared-tier tails; address Studio's
three inherited moderate dependency findings through a separately verified update.
No assertion of exhaustive assistive-technology or multi-day production testing.
