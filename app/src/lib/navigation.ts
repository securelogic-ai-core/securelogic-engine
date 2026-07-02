/**
 * navigation.ts — the single source of truth for the app's top navigation.
 *
 * This is plain, dependency-free data (no React, no Next imports) so it can be:
 *   - rendered by the header (`components/Header.tsx`), and
 *   - read by the Application Knowledge Index generator
 *     (`scripts/generate-app-knowledge-index.ts`) to auto-derive the navigation
 *     hierarchy, menus, dropdowns, labels, and permissions that "Ask
 *     SecureLogic" uses to answer platform-navigation questions.
 *
 * Because both the live UI and the generated index come from THIS array, the
 * assistant's navigation answers cannot drift from the real menu — a
 * regression test regenerates the index from this file and fails on any
 * mismatch.
 *
 * Entitlement flags mirror the gating computed in `app/layout.tsx`:
 *   - platform → visible to premium / platform / team tiers
 *   - premium  → visible to premium / professional / platform / team tiers
 *   - admin    → visible to admin-role users only
 * An item with no flag is visible to everyone signed in.
 */

export type NavItem =
  | { type: "link"; label: string; href: string; platform?: boolean; premium?: boolean; admin?: boolean }
  | {
      type: "group";
      label: string;
      platform?: boolean;
      premium?: boolean;
      admin?: boolean;
      items: Array<{ label: string; href: string }>;
    };

export const NAV_ITEMS: NavItem[] = [
  { type: "link",  label: "Dashboard", href: "/dashboard" },
  { type: "link",  label: "Briefs",    href: "/briefs" },
  { type: "link",  label: "Ask",       href: "/ask",       platform: true },
  { type: "link",  label: "Queue",     href: "/queue",     platform: true },
  { type: "group", label: "Assets",    platform: true,
    items: [
      { label: "Vendors",    href: "/vendors" },
      { label: "AI Systems", href: "/ai-systems" },
    ],
  },
  { type: "group", label: "Compliance", platform: true,
    items: [
      { label: "Controls",    href: "/controls" },
      { label: "Frameworks",  href: "/frameworks" },
      { label: "Policies",    href: "/policies" },
      { label: "Obligations", href: "/obligations" },
    ],
  },
  { type: "group", label: "Risk", platform: true,
    items: [
      { label: "Findings",      href: "/findings" },
      { label: "Actions",       href: "/actions" },
      { label: "Risk Register", href: "/risks" },
    ],
  },
  { type: "link", label: "Audit Log", href: "/audit-log", admin: true },
];

export function filterNav(
  items: NavItem[],
  isPlatformUser: boolean,
  isPremiumUser: boolean,
  isAdminUser: boolean,
): NavItem[] {
  return items.filter(item => {
    if (item.platform && !isPlatformUser) return false;
    if (item.premium  && !isPremiumUser)  return false;
    if (item.admin    && !isAdminUser)    return false;
    return true;
  });
}

// ─── Secondary navigation (account / settings surfaces) ───────────────────────
//
// The top NAV_ITEMS above are the header menu. A second family of
// customer-facing destinations lives OUTSIDE the header — the account/profile
// area, billing, the per-org settings pages (security, SSO, webhooks, risk
// scale/policy), and the onboarding checklist. These are reached from the user
// menu (`components/UserMenu.tsx`) and the account/settings pages, not the
// header dropdowns, so they were never part of the header-derived knowledge the
// "Ask SecureLogic" assistant sees.
//
// This array is the machine-readable source of truth for those destinations.
// Like NAV_ITEMS, it is plain dependency-free data so the Application Knowledge
// Index generator can read it; every `href` is validated against the real
// `app/src/app/**` route tree by the drift test — the assistant can therefore
// point users to these pages without inventing paths.
//
// Entitlement (`access`) is DECLARED here, exactly as NAV_ITEMS declares its
// header flags. It must be declared — and cannot be safely inferred — because
// these pages enforce their gating in the Server Component body (e.g.
// `if (role !== "admin") redirect(...)`, or an entitlement upsell wall), which
// neither the route scanner (it only checks for a `page.tsx`) nor the index
// builder (it only reads the header NAV_ITEMS flags) can see. Declare `access`
// on any item whose page restricts who can actually use it; omit it for a
// signed-in-only destination and the builder defaults it to "all". Keep these
// values honest against the real page guards — the drift test asserts the
// gated pages still carry their guard so this metadata can't silently rot.
//
// Grouped for readable rendering; `group` order below is preserved.

/**
 * Entitlement required to actually use a secondary destination. Mirrors the
 * `NavAccess` union in the index builder, declared locally so this file stays
 * dependency-free (no engine imports).
 */
export type SecondaryNavAccess = "all" | "premium" | "platform" | "admin";

export type SecondaryNavItem = {
  label: string;
  href: string;
  group: string;
  /**
   * Entitlement required to actually use the destination, mirroring the real
   * page-body guard. Omit for signed-in-only pages (defaults to "all").
   */
  access?: SecondaryNavAccess;
};

export const SECONDARY_NAV_ITEMS: SecondaryNavItem[] = [
  // Account & profile
  { group: "Account",  label: "Account, profile & billing", href: "/account" },
  { group: "Account",  label: "Team & users",               href: "/account/team" },
  { group: "Account",  label: "API keys",                    href: "/account/api-keys" },
  { group: "Account",  label: "Notifications & alerts",      href: "/account/alerts" },
  { group: "Account",  label: "Privacy & data rights",       href: "/account/privacy" },
  // Billing / subscription
  { group: "Billing",  label: "Plans & pricing",             href: "/pricing" },
  // Settings
  // /settings/security redirects non-admins away; /settings/sso shows non-Pro
  // orgs an upsell wall instead of the feature. Both gates live in the page
  // body, so their entitlement is declared explicitly here.
  { group: "Settings", label: "Security settings",           href: "/settings/security", access: "admin" },
  { group: "Settings", label: "Single sign-on (SSO)",        href: "/settings/sso",      access: "premium" },
  { group: "Settings", label: "Webhooks",                    href: "/settings/webhooks" },
  { group: "Settings", label: "Risk rating scale",           href: "/settings/risk-scale" },
  { group: "Settings", label: "Risk policy",                 href: "/settings/risk-policy" },
  // Onboarding
  { group: "Onboarding", label: "Getting started checklist", href: "/getting-started" },
];
