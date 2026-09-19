# Product and design foundation

## V1 product contract

HubZero Identity is presented as **HubZero Account**. It serves a controlled internal population, beginning with the five migrated Studio people. There is no self-registration, signup link, social login, passkey, MFA, broad admin console, organization/tenant model, or Fitness data.

The account surface contains Account, Profile, Security, Sessions, and Applications. It explains associations without implying universal access. Auth screens name the requesting application. Authentication failure and authorization denial are different states and use different copy.

## Interaction vocabulary

- Primary entry: **Continue with HubZero**
- Issuer sign-in action: **Continue**
- No session: **Sign in required**
- Valid account without membership: **Access unavailable**
- Membership is **Active** or unavailable; account is **active** or **suspended**
- OAuth, OIDC, claims, grants, and clients are implementation vocabulary and stay out of ordinary user copy.

## Design direction

The visual metaphor is a calibrated engineering instrument: a graphite identity rail carries brand and trust context; a paper-white workspace uses strong typography, measured spacing, and hairline boundaries. Cobalt is reserved for intent and focus, green for verified/current states, amber for important guidance, and red for destructive action or denial.

### Tokens

| Token | Value | Use |
|---|---:|---|
| Paper | `#fbfbfa` | application background |
| Surface | `#ffffff` | inputs and elevated-by-contrast regions |
| Ink | `#17191c` | primary text |
| Graphite | `#1b2027` | authentication identity rail |
| Signal | `#1d4ed8` | primary actions, links, focus |
| Line | `#dfe2e5` | structural separation |
| Danger | `#b42318` | denial/destructive actions |

Typography is Manrope Variable: precise geometric forms, readable lowercase, and enough warmth for an account product. Headings use tight tracking and moderate weight rather than oversized display treatments. Body lines stay below roughly 70 characters.

Spacing follows a practical 4 px base with common steps 8, 12, 16, 20, 24, 32, 40, 48, and 64. Content width is capped near 812 px inside the account shell; authentication forms cap at 420 px. Radii are 5 px for controls and 9 px for grouped data—small enough to feel constructed, not soft/decorative. Shadows are not part of the baseline.

### Components and states

- Inputs are 44 px high with persistent labels, clear hover border, 2 px cobalt focus plus halo, and inline error space reserved in implementation.
- Primary, secondary, and destructive buttons use action-specific copy; loading preserves button width and announces status without relying on animation.
- Status always combines text with its colored indicator.
- Empty states explain why the area is empty and what action, if any, follows.
- Errors sit beside their field, connect through `aria-describedby`, and a form summary receives focus when multiple errors occur.
- The password visibility control has a changing accessible label and never changes the stored value.

### Responsive behavior

At 720 px and below, the desktop rail becomes a compact brand header and horizontally scrollable account navigation. Content padding contracts to 20 px, multi-column facts stack, session actions wrap below their device, and auth uses the full mobile stage. Touch controls meet at least 42–44 px where actionable. No desktop sidebar is squeezed into a narrow viewport.

### Accessibility

Use semantic landmarks/headings/forms, programmatic labels, correct `autocomplete`, keyboard-operable controls, visible `:focus-visible`, text alongside color, polite live regions for asynchronous outcomes, and focus transfer for navigation/errors/dialogs. Respect `prefers-reduced-motion`; baseline screens have no unsolicited motion. Server-render forms should use progressive POST behavior where possible and fail closed if client protocol state is unavailable.

## Live account data

Phase 3 replaces the Phase 1 Account, Profile, Security, Sessions, Applications, and sign-in fixtures with server-side Identity data. The Account shell displays only permitted user-facing values: name, email, membership/application labels, and conservative browser summaries. It does not display subjects, MongoDB IDs, hashes, raw IPs, or internal security versions. Studio role information remains absent until Studio provides its own contract.
