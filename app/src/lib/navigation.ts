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
