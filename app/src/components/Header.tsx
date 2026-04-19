"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import UserMenu from "./UserMenu";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.securelogicai.com";

interface HeaderProps {
  organizationName?: string;
  isAuthenticated: boolean;
  /** Show platform nav items (Vendors, AI Systems, Controls) for platform subscribers only */
  isPlatformUser?: boolean;
  /** Show premium-only nav items (Audit Log) */
  isPremiumUser?: boolean;
  /** Show SSO settings link for professional+ orgs */
  isSsoEligible?: boolean;
  /** Current user name — shown in avatar */
  userName?: string;
  /** Current user email */
  userEmail?: string;
  /** Current user role */
  userRole?: string;
}

export function Header({
  organizationName,
  isAuthenticated,
  isPlatformUser = false,
  isPremiumUser = false,
  isSsoEligible = false,
  userName,
  userEmail,
  userRole,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (mobileOpen && !(e.target as HTMLElement).closest("header")) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

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
              <Link href="/dashboard" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                Dashboard
              </Link>
              <Link href="/briefs" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                Briefs
              </Link>
              {isPlatformUser && (
                <>
                  <Link href="/vendors"     className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Vendors</Link>
                  <Link href="/ai-systems"  className="text-slate-300 hover:text-white text-sm font-medium transition-colors">AI Systems</Link>
                  <Link href="/controls"    className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Controls</Link>
                  <Link href="/obligations" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Obligations</Link>
                  <Link href="/policies"    className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Policies</Link>
                  <Link href="/frameworks"  className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Frameworks</Link>
                  <Link href="/findings"    className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Findings</Link>
                  <Link href="/actions"    className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Actions</Link>
                  <Link href="/risks"      className="text-slate-300 hover:text-white text-sm font-medium transition-colors">Risk Register</Link>
                </>
              )}
              {isPremiumUser && (
                <Link href="/audit-log" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                  Audit Log
                </Link>
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
                href={`${SITE_URL}/pricing/`}
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
          onClick={() => setMobileOpen((o) => !o)}
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
                <Link href="/dashboard" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Dashboard</Link>
                <Link href="/briefs"    onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Briefs</Link>
                {isPlatformUser && (
                  <>
                    <Link href="/vendors"     onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Vendors</Link>
                    <Link href="/ai-systems"  onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">AI Systems</Link>
                    <Link href="/controls"    onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Controls</Link>
                    <Link href="/obligations" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Obligations</Link>
                    <Link href="/policies"    onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Policies</Link>
                    <Link href="/frameworks"  onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Frameworks</Link>
                    <Link href="/findings"    onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Findings</Link>
                    <Link href="/actions"    onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Actions</Link>
                    <Link href="/risks"      onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Risk Register</Link>
                  </>
                )}
                {isPremiumUser && (
                  <Link href="/audit-log" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Audit Log</Link>
                )}
                <div className="mt-2 pt-2" style={{ borderTop: "1px solid #1e293b" }}>
                  <Link href="/account" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Account</Link>
                  <div className="px-3 py-2">
                    <LogoutButton />
                  </div>
                </div>
              </>
            ) : (
              <>
                <a href={SITE_URL} onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">securelogicai.com</a>
                <Link href="/login" onClick={closeMobile} className="block py-2 px-3 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">Sign In</Link>
                <div className="px-3 py-2">
                  <a
                    href={`${SITE_URL}/pricing/`}
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
