# SecureLogic AI — Enterprise Information Architecture

**Status:** Ratified (Phase 1). This document is the source of truth for the
SecureLogic AI ecosystem's information architecture — sitemap, URL structure,
global navigation, footer architecture, cross-property contracts, and the
design-language declaration. It fills the gap left by the never-written
`SECURELOGIC_UI_BRIEF.md`. Subsequent UI phases cite this document.

It conforms to the governing docs (`PRODUCT_VISION.md`, `FINAL_PRODUCT_STANDARD.md`,
`CANONICAL_DOMAIN_MODEL.md`, `CURRENT_STATE_ARCHITECTURE.md`) and does not
override them.

---

## 1. Design-language declaration
**Dark is the canonical design language** for the entire ecosystem. Tokens are
defined once in `website/src/app/globals.css` and `website/tailwind.config.ts`
(`bg #0a1628`, `bg-elevated`, `bg-elevated-2`, `hairline`, `text/-body/-muted`,
`accent #00c4b4`, `accent-hover`, `success/danger/warning`). The previously
split light theme (the legacy `teal`/`navy` scales) is retired from the
marketing site. The authenticated app keeps its established top-nav shell and
adopts the same palette over time (see §6, deferred).

## 2. Properties & domain map
| Surface | Host | Owns |
|---|---|---|
| Marketing | `www.securelogicai.com` (`website/`) | Positioning, pricing, brief signup, **canonical legal**, Trust Center, Resources |
| Application | `app.securelogicai.com` (`app/`) | Auth, onboarding, dashboard, the five domains, billing, account/settings |
| Status (future) | `status.securelogicai.com` | Uptime (external provider — linked, not built) |

**Contracts (load-bearing):**
1. Cross-links resolve through env only — site→app via `NEXT_PUBLIC_APP_URL`,
   app→site via `NEXT_PUBLIC_SITE_URL`. No hardcoded hosts.
2. Plan deep-links use only the four canonical tokens: `professional`,
   `teams`, `platform`, `platform_annual` (matches `app` `parsePlanParam()`).
3. **Legal lives only on marketing.** The app references
   `securelogicai.com/{terms,privacy,ai-policy}` and never re-hosts legal text.
4. **Pricing canonical = marketing.** Tier names are fixed to the five canonical
   packages; "Platform Annual" is never surfaced as a standalone tier.
5. No dead links: every nav/footer href resolves to a real destination.
6. The app logged-out root stays retired (`/` → `/login`); do not reintroduce a
   public app landing page.

## 3. Marketing site — global navigation
Primary nav (Platform-first; the Brief is the wedge, surfaced but never above
the Platform). Source of truth: `website/src/lib/nav.ts`.

```
Platform ▾   Intelligence Brief   Pricing   Resources   Trust Center      [Sign In]  [Start Free Trial]
  ├ Platform overview     → /platform/
  ├ Cyber Intelligence    → /platform/#intelligence
  ├ Vendor Risk           → /platform/#vendor-risk
  ├ AI Governance         → /platform/#ai-governance
  └ Compliance            → /platform/#compliance
```
- `Sign In` → `${APP_URL}/login`. Primary CTA `Start Free Trial` →
  `${APP_URL}/signup?plan=platform_annual`.
- "Company" (About, Contact) is footer-only to keep the bar lean.
- **Documentation** is intentionally not in nav until real product-docs content
  exists (no-placeholder standard).
- **Known gap:** the platform page presents four of the five canonical domains.
  When a **Risk Operations** section (`#risk-operations`) is added to
  `/platform`, add it to `PLATFORM_DOMAINS` in `nav.ts`.

### Sitemap (after Phase 1)
```
/                    Home (dark)
/platform            Platform overview + 4 domain sections (dark)
/intelligence-brief  The wedge (dark)
/pricing             Pricing (dark)
/resources           Resources hub (dark) — NEW
/trust               Trust Center hub (dark) — NEW
/security            Security detail (dark) — now reachable from nav/footer
/about /contact      Company (dark)
/privacy /terms /ai-policy   Legal (dark; dates from lib/legal.ts)
```

## 4. Footer architecture
Five columns rendered from `FOOTER_COLUMNS` in `nav.ts`, plus a brand/connect/
legal-entity bottom bar:
- **Platform** — overview, the four domains, Pricing
- **Intelligence Brief** — Get the Free Brief, Brief Pro, Team Professional, Sample issue
- **Resources** — Resources, Security Overview (PDF)
- **Trust & Legal** — Trust Center, Security, Privacy, Terms, AI Policy
- **Company** — About, Contact, Sign In
- Bottom bar: © Threat Loom, LLC d/b/a SecureLogic AI · Tinton Falls, NJ · email · LinkedIn · X

## 5. Legal date governance
`website/src/lib/legal.ts` defines `LAUNCH_DATE` once; `LEGAL_EFFECTIVE_DATE`
and `LEGAL_LAST_UPDATED` both derive from it. The three legal pages pass these
to `MarkdownPage`. Setting `LAUNCH_DATE` at the launch cutover dates all three
documents — the only edit required. Authoring placeholders (`[INSERT DATE]`) no
longer drive any rendered output.

## 6. Application — target IA (specified; built under separate authorization)
These make the ecosystem cohesive but touch platform code; each requires its own
architect-review brief and authorization and is **not** part of Phase 1:
- **A1.** Add `/posture` to the app primary nav (`app/src/components/Header.tsx`) — currently orphaned.
- **A2.** Add an app footer linking Trust Center + legal + status, for parity.
- **A3.** Unify the fragmented `/settings/*` + `/account/*` under one Settings index.
- **A4.** Resolve in-app `/pricing` + `/register` redundancy vs canonical marketing.
- **A5.** Align the app token palette to the dark system.

## 7. Out of Phase 1 scope (tracked elsewhere)
Cookie & Accessibility pages (Phases 4/5), SEO infrastructure — robots, sitemap,
OG image, JSON-LD (Phase 6), contact/demo backend + scheduler (Phase 3), and all
§6 app-side items. Listed here only to make the boundary explicit.
