"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import UserMenu from "./UserMenu";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.securelogicai.com";

// ─── Nav config ───────────────────────────────────────────────────────────────

type NavItem =
  | { type: "link";  label: string; href: string; platform?: boolean; premium?: boolean; admin?: boolean }
  | { type: "group"; label: string; platform?: boolean; premium?: boolean; admin?: boolean;
      items: Array<{ label: string; href: string }> };

const NAV_ITEMS: NavItem[] = [
  { type: "link",  label: "Dashboard", href: "/dashboard" },
  { type: "link",  label: "Briefs",    href: "/briefs" },
  { type: "link",  label: "Ask",       href: "/ask",       platform: true },
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

function filterNav(
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

// ─── Inline chevron (no icon-lib dependency) ──────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
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

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className="text-sm font-medium transition-colors"
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

  const isActive = items.some(
    item => pathname === item.href || pathname.startsWith(item.href + "/"),
  );

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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-sm font-medium transition-colors"
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
              className="block px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
              style={{ color: pathname === item.href ? "#00c4b4" : "#cbd5e1" }}
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

  const visibleNav = filterNav(NAV_ITEMS, isPlatformUser, isPremiumUser, isAdminUser);

  return (
    <header className="relative sticky top-0 z-50 bg-navy-900/95 backdrop-blur-md border-b border-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.06),0_4px_24px_rgba(0,0,0,0.5)]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Wordmark */}
        <Link href={isAuthenticated ? "/dashboard" : "/"} className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/securelogic-ai-logo.png"
            alt="SecureLogic AI"
            width={28}
            height={28}
            className="rounded"
          />
          <div className="flex flex-col leading-none">
            <span className="text-white font-semibold text-sm tracking-wide">
              SecureLogic AI
            </span>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-6">
          {isAuthenticated ? (
            <>
              {visibleNav.map(item =>
                item.type === "link" ? (
                  <NavLink key={item.label} href={item.href} label={item.label} />
                ) : (
                  <NavGroup key={item.label} label={item.label} items={item.items} />
                ),
              )}
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
            </>
          ) : (
            <>
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
            </>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-slate-800"
          onClick={() => setMobileOpen(o => !o)}
          aria-label="Toggle menu"
          style={{ color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
        >
          <span style={{ fontSize: "18px", lineHeight: 1 }}>{mobileOpen ? "✕" : "☰"}</span>
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden absolute top-14 left-0 right-0 z-50 border-b"
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
