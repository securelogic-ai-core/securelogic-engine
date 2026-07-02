/**
 * Information-architecture model — the single source of truth for the global
 * primary navigation and the footer. `Nav`, `Footer`, and any future sitemap
 * all render from these structures so the three can never drift.
 *
 * Conventions (see docs/architecture/ENTERPRISE_IA.md):
 *  - Internal routes use trailing slashes (static-export requirement).
 *  - `app: true`      → resolve the href against NEXT_PUBLIC_APP_URL (the product).
 *  - `external: true` → render a plain <a> that opens in a new tab (absolute
 *                       URL or static asset such as the Security Overview PDF).
 *  - Platform-first ordering: the Platform leads; the Intelligence Brief is the
 *    wedge, surfaced as its own item but never above the Platform.
 */

export interface NavLink {
  label: string;
  href: string;
  /** Resolve against the app origin (NEXT_PUBLIC_APP_URL). */
  app?: boolean;
  /** Open in a new tab (absolute URL or static asset). */
  external?: boolean;
}

export interface NavDropdown {
  label: string;
  href: string;
  items: NavLink[];
}

export type NavItem = NavLink | NavDropdown;

export function isDropdown(item: NavItem): item is NavDropdown {
  return (item as NavDropdown).items !== undefined;
}

// The platform page presents four of the five canonical connected domains as
// in-page sections; we link to the anchors that actually exist (no dead links).
// Risk Operations is a documented content gap — when /platform gains that
// section, add { label: "Risk Operations", href: "/platform/#risk-operations" }.
const PLATFORM_DOMAINS: NavLink[] = [
  { label: "Cyber Intelligence", href: "/platform/#intelligence" },
  { label: "Vendor Risk", href: "/platform/#vendor-risk" },
  { label: "AI Governance", href: "/platform/#ai-governance" },
  { label: "Compliance", href: "/platform/#compliance" },
];

/** Global primary navigation (left/centre of the header). */
export const PRIMARY_NAV: NavItem[] = [
  {
    label: "Platform",
    href: "/platform/",
    items: [{ label: "Platform overview", href: "/platform/" }, ...PLATFORM_DOMAINS],
  },
  { label: "Intelligence Brief", href: "/intelligence-brief/" },
  { label: "Pricing", href: "/pricing/" },
  { label: "Resources", href: "/resources/" },
  { label: "Trust Center", href: "/trust/" },
];

/** Header call-to-action pair (right of the header). Both resolve to the app. */
export const NAV_SIGN_IN: NavLink = { label: "Sign In", href: "/login", app: true };
export const NAV_PRIMARY_CTA: NavLink = {
  label: "Start Free Trial",
  href: "/signup?plan=platform_annual",
  app: true,
};

/** Static Security Overview asset, referenced from Trust + Resources + Security. */
export const SECURITY_OVERVIEW_PDF = "/SecureLogic-AI-Security-Overview-v1.pdf";

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Platform",
    links: [
      { label: "Platform overview", href: "/platform/" },
      ...PLATFORM_DOMAINS,
      { label: "Pricing", href: "/pricing/" },
    ],
  },
  {
    title: "Intelligence Brief",
    links: [
      { label: "Get the Free Brief", href: "/#brief-signup" },
      { label: "Brief Pro", href: "/pricing/" },
      { label: "Brief Team", href: "/pricing/" },
      { label: "Sample issue", href: "/intelligence-brief/" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Resources", href: "/resources/" },
      { label: "Security Overview (PDF)", href: SECURITY_OVERVIEW_PDF, external: true },
    ],
  },
  {
    title: "Trust & Legal",
    links: [
      { label: "Trust Center", href: "/trust/" },
      { label: "Security", href: "/security/" },
      { label: "Privacy Policy", href: "/privacy/" },
      { label: "Terms of Service", href: "/terms/" },
      { label: "AI Policy", href: "/ai-policy/" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about/" },
      { label: "Contact", href: "/contact/" },
      { label: "Sign In", href: "/login", app: true },
    ],
  },
];
