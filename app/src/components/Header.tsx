"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import UserMenu from "./UserMenu";
import { GlobalUtilities } from "./GlobalUtilities";
import { getNavItems, filterNav, isNavItemActive, type NavFlags } from "@/lib/navigation";
import { getSiteBaseUrl } from "@/lib/siteUrl";

// Marketing-site base for the logo/home link. Env-aware + build-time — see
// getSiteBaseUrl(). Staging must set NEXT_PUBLIC_SITE_URL or this links back to prod.
const SITE_URL = getSiteBaseUrl();

// ─── Nav config ───────────────────────────────────────────────────────────────

// getNavItems (legacy vs risk-workspace model), filterNav, and the NavItem type
// come from `@/lib/navigation` (the single source of truth shared with the
// Application Knowledge Index generator). getNavItems picks the workspace IA when
// the risk_workspace flag is on; otherwise the legacy menu, byte-for-byte.

// ─── Inline chevron (no icon-lib dependency) ──────────────────────────────────

// 10px in the tablet nav band, 14px from `lg`. The width/height attributes are
// the pre-CSS fallback; the classes win. Five groups carry a chevron, so 4px off
// each is 20px off the band — a real lever at 768px, not a detail.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="w-2.5 h-2.5 lg:w-3.5 lg:h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transition: "transform 0.15s",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Desktop: plain link ──────────────────────────────────────────────────────

// `text-xs lg:text-sm` and `whitespace-nowrap`: at the tablet-portrait
// breakpoint the nav band must hold every workspace entry on ONE line, and it
// is presentation — type size, chevron size and gap — that buys the room. See
// the nav band in the Header for the measurements. `shrink-0` is load-bearing:
// without it the flex items SHRINK to fit and the labels squeeze into each
// other, which measures as "fits" while looking broken. `whitespace-nowrap`
// stops "Risk Operations" breaking mid-label.
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className="shrink-0 whitespace-nowrap text-xs lg:text-sm font-medium transition-colors"
      style={{ color: active ? "#00c4b4" : "#cbd5e1" }}
    >
      {label}
    </Link>
  );
}

// ─── Desktop: dropdown group ──────────────────────────────────────────────────

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; href: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Query-aware: Operations Workspace and Finding Explorer share the /findings
  // path, so path-only matching would highlight the wrong child (see
  // isNavItemActive). Safe in the root layout — the tree is already dynamically
  // rendered because layout.tsx awaits getSession() (cookies).
  const search = useSearchParams()?.toString() ?? "";
  const hrefs = items.map(i => i.href);

  // Group button: descendant match, as before (`/risks/abc` keeps "Risk" lit).
  const isActive = items.some(item => isNavItemActive(item.href, pathname, search, hrefs, true));

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    // `shrink-0` so the group keeps its natural width in the one-line nav band.
    // The panel below is anchored to THIS element (`absolute top-full`), so the
    // anchoring is unchanged by the band's sizing.
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-0.5 lg:gap-1 whitespace-nowrap text-xs lg:text-sm font-medium transition-colors"
        style={{
          color: isActive ? "#00c4b4" : "#cbd5e1",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {label}
        <Chevron open={open} />
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 left-0 z-50 rounded-xl border py-1 min-w-[180px]"
          style={{
            background: "#0f172a",
            borderColor: "#1e293b",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm whitespace-nowrap transition-colors hover:bg-white/5"
              style={{
                color: isNavItemActive(item.href, pathname, search, hrefs) ? "#00c4b4" : "#cbd5e1",
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  organizationName?: string;
  isAuthenticated: boolean;
  /** Platform nav items (Vendors, AI Systems, Controls, etc.) */
  isPlatformUser?: boolean;
  /** Premium-only nav items */
  isPremiumUser?: boolean;
  /** Admin-only nav items (Audit Log) */
  isAdminUser?: boolean;
  /** SSO settings link for professional+ orgs */
  isSsoEligible?: boolean;
  /**
   * Server-resolved feature flags for flag-gated nav items (fail-closed: a flagged
   * item is hidden unless its key is true). Resolved in app/layout.tsx from env —
   * this is a client component and can't read non-NEXT_PUBLIC env itself.
   */
  navFlags?: NavFlags;
  userName?: string;
  userEmail?: string;
  userRole?: string;
}

export function Header({
  organizationName,
  isAuthenticated,
  isPlatformUser = false,
  isPremiumUser = false,
  isAdminUser = false,
  isSsoEligible = false,
  navFlags,
  userName,
  userEmail,
  userRole,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (mobileOpen && !(e.target as HTMLElement).closest("header")) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [mobileOpen]);

  const visibleNav = filterNav(getNavItems(navFlags), isPlatformUser, isPremiumUser, isAdminUser, navFlags);
  // Global utilities (Search, Ask SecureLogic) render in the upper-right cluster
  // for authenticated platform users — the same entitlement both carried as nav
  // items, in BOTH nav models and at every breakpoint. No feature flag: this is
  // a relocation of existing entries, so gating them on one would DARKEN two
  // live surfaces rather than move them.
  const showGlobalUtilities = isAuthenticated && isPlatformUser;

  return (
    <header className="relative sticky top-0 z-50 bg-navy-900/95 backdrop-blur-md border-b border-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.06),0_4px_24px_rgba(0,0,0,0.5)]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-3">

        {/* Wordmark */}
        <Link href={isAuthenticated ? "/dashboard" : SITE_URL} className="flex items-center gap-3">
          {/* Icon-only mark; the adjacent text is the single wordmark, so the
              image is decorative (alt="" + aria-hidden) to avoid a redundant
              accessible name. Matches the AuthCard branding. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/securelogic-ai-icon.png"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
            className="rounded-md"
          />
          <div className="flex flex-col leading-none">
            <span className="text-white font-semibold text-sm tracking-wide">
              SecureLogic AI
            </span>
          </div>
        </Link>

        {/* Signed-out links stay in ROW 1 — the two-row structure below is the
            authenticated workspace header. A signed-out visitor has no workspace
            nav, so a second row would render empty. */}
        {!isAuthenticated && (
          <nav className="hidden md:flex items-center gap-6">
            <a href={SITE_URL} className="text-slate-400 hover:text-white text-sm transition-colors">
              securelogicai.com
            </a>
            <Link href="/login" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
              Sign In
            </Link>
            <a
              href="/signup"
              className="bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
            >
              Get Started
            </a>
          </nav>
        )}

        {/* Global utilities + profile — ROW 1, upper right, every breakpoint.
            The utilities are deliberately outside the workspace nav (now ROW 2)
            so they survive the tablet/mobile collapse; the profile control
            appears from `md` up, where the drawer — which also carries the
            account links — is no longer the only nav path. */}
        <div className="flex items-center gap-2 lg:gap-3">
          {showGlobalUtilities && <GlobalUtilities showSearch showAsk />}

          {isAuthenticated && (
            <div className="hidden md:flex items-center gap-6">
              {userName ? (
                <UserMenu
                  name={userName}
                  email={userEmail ?? ""}
                  role={userRole ?? "admin"}
                  organizationName={organizationName}
                  isPlatformUser={isPlatformUser}
                  isSsoEligible={isSsoEligible}
                />
              ) : (
                <>
                  <Link href="/account" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                    {organizationName ?? "Account"}
                  </Link>
                  <LogoutButton />
                </>
              )}
            </div>
          )}

          {/* Mobile hamburger — below `md` only, where ROW 2 is not rendered and
              the drawer is the sole path to the workspace nav. */}
          <button
            className="md:hidden flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-slate-800"
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle menu"
            style={{ color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
          >
            <span style={{ fontSize: "18px", lineHeight: 1 }}>{mobileOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {/* ─── ROW 2 — the workspace nav band ────────────────────────────────────
          A real second row: a sibling block below the ROW 1 container, NOT a
          margin/padding offset on the header. Nothing from ROW 1 (logo, Search,
          Ask, avatar) moves down — those stay in the h-14 container above.

          The header keeps its own `border-b`, so the header's bottom border sits
          below THIS row. The hairline `border-t` here separates the two rows.

          ONE LINE at every breakpoint it renders at, bought with presentation
          only — type size, chevron size and gap. No wrapping, no horizontal
          scroll, no restructuring of the dropdowns.

          Measured against the real nav content at 768px, where the usable width
          inside `px-6` is 720px and the nine entries have a NATURAL width of
          715.6px at 13px type — i.e. they do not fit at 13px on any gap at all:

            type  chevron  chev gap  item gap   total    headroom
            13px    14px      4px      10px     795.6px   −75.6px  (overflowed)
            12px    14px      4px       8px     731.5px    −11.5px
            12px    10px      2px       8px     701.5px    +18.5px  ← chosen
            11.5px  10px      2px       8px     677.5px    +42.5px  (type too small)

          `shrink-0` on the items is load-bearing and easy to remove by
          accident: without it the flex items shrink to fit, so the band always
          "fits" while the labels squeeze into each other. It also means a
          measurement taken WITHOUT it reports the container width rather than
          the content width — which is how 13px was picked, wrongly, first time.

          Neither `flex-wrap` nor `overflow-x-auto` is used. Wrapping puts the
          tail of the nav on a second line; an overflow container becomes a
          clipping context and would cut off the NavGroup dropdowns, which
          render `absolute top-full` inside it.

          The headroom is 18.5px at nine entries. The count is not fixed — it
          varies with entitlement, admin role and four feature flags — and a
          TENTH top-level entry would not fit on one line at 768px. Today only
          "Executive" can add one, behind `risk_intelligence`, which is off in
          staging and production. Turning that flag on is the trigger to revisit
          this band.

          Rendered from `md` up, matching the ROW 1 avatar and the hamburger
          breakpoint: below `md` the drawer remains the single nav path. */}
      {isAuthenticated && (
        <div className="hidden md:block border-t border-slate-800/60">
          <div className="max-w-6xl mx-auto px-6">
            <nav className="flex flex-nowrap items-center gap-x-2 lg:gap-x-6 py-2.5">
              {visibleNav.map(item =>
                item.type === "link" ? (
                  <NavLink key={item.label} href={item.href} label={item.label} />
                ) : (
                  <NavGroup key={item.label} label={item.label} items={item.items} />
                ),
              )}
            </nav>
          </div>
        </div>
      )}

      {/* Mobile drawer — `top-full` so it hangs below the whole header rather
          than a hardcoded single-row height. */}
      {mobileOpen && (
        <div
          className="md:hidden absolute top-full left-0 right-0 z-50 border-b"
          style={{ background: "#0a0f1a", borderColor: "#1e293b" }}
        >
          <nav className="flex flex-col px-4 py-3 gap-1">
            {isAuthenticated ? (
              <>
                {visibleNav.map(item => {
                  if (item.type === "link") {
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={closeMobile}
                        className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        {item.label}
                      </Link>
                    );
                  }
                  // group → section header + indented children
                  return (
                    <div key={item.label} className="pb-2">
                      <p
                        className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "#475569" }}
                      >
                        {item.label}
                      </p>
                      {item.items.map(child => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={closeMobile}
                          className="block py-2 pl-6 pr-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  );
                })}
                {/* Account section only. Search and Ask are NOT here: they are
                    global utilities rendered in the top bar at this breakpoint
                    too, so the drawer never has to be opened to reach them. */}
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid #1e293b" }}>
                  <Link href="/account" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
                    Account
                  </Link>
                  <Link href="/settings/risk-scale" onClick={closeMobile} className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Settings
                  </Link>
                  <div className="px-3 py-2">
                    <LogoutButton />
                  </div>
                </div>
              </>
            ) : (
              <>
                <a href={SITE_URL} onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                  securelogicai.com
                </a>
                <Link href="/login" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
                  Sign In
                </Link>
                <div className="px-3 py-2">
                  <a
                    href="/signup"
                    className="inline-block bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
                  >
                    Get Started
                  </a>
                </div>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
