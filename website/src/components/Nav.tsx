"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface NavProps {
  appUrl: string;
}

const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing/" },
  { label: "Sources", href: "/#sources" },
  { label: "About", href: "/about/" },
];

export function Nav({ appUrl }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Strengthen the bottom border + backdrop once the page is scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-bg/80 backdrop-blur-md transition-colors duration-200 border-b ${
        scrolled ? "border-hairline shadow-[0_4px_24px_rgba(0,0,0,0.45)]" : "border-transparent"
      }`}
    >
      <nav className="container-site" aria-label="Primary">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <Image
              src="/branding/securelogic-ai-logo.png"
              alt="SecureLogic AI"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
              priority
            />
            <span className="text-text font-semibold text-[15px] tracking-tight">
              SecureLogic AI
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-3 py-2 text-sm font-medium text-text-muted rounded-md hover:text-text hover:bg-white/5 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href={`${appUrl}/login`}
              className="px-4 py-2 text-sm font-semibold rounded-[10px] border border-hairline text-text hover:border-accent hover:text-white transition-colors"
            >
              Sign In
            </a>
            <Link href="/#brief-signup" className="btn-primary px-4 py-2">
              Get the Free Brief
            </Link>
          </div>

          {/* Mobile: keep the primary CTA visible alongside the menu toggle */}
          <div className="flex items-center gap-2 md:hidden">
            <Link href="/#brief-signup" className="btn-primary px-3.5 py-2 text-[13px]">
              Get the Free Brief
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              className="p-2 rounded-md text-text-muted hover:text-text hover:bg-white/5 transition-colors"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div id="mobile-menu" className="md:hidden border-t border-hairline py-3 space-y-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 text-sm font-medium text-text-muted hover:text-text hover:bg-white/5 rounded-md transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 mt-2 border-t border-hairline">
              <a
                href={`${appUrl}/login`}
                className="block px-3 py-2.5 text-sm font-semibold text-text-muted hover:text-text rounded-md transition-colors"
              >
                Sign In
              </a>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
