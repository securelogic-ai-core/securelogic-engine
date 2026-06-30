"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  PRIMARY_NAV,
  NAV_SIGN_IN,
  NAV_PRIMARY_CTA,
  isDropdown,
  type NavItem,
  type NavLink as NavLinkType,
} from "@/lib/nav";

interface NavProps {
  appUrl: string;
}

export function Nav({ appUrl }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  const resolve = (link: NavLinkType) => (link.app ? `${appUrl}${link.href}` : link.href);

  // Strengthen the bottom border + backdrop once the page is scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close any open dropdown / mobile menu on navigation.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  // Close the open dropdown on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
            {PRIMARY_NAV.map((item) => (
              <DesktopNavItem
                key={item.label}
                item={item}
                open={openMenu === item.label}
                onOpen={() => setOpenMenu(item.label)}
                onClose={() => setOpenMenu((cur) => (cur === item.label ? null : cur))}
              />
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href={resolve(NAV_SIGN_IN)}
              className="px-4 py-2 text-sm font-semibold rounded-[10px] border border-hairline text-text hover:border-accent hover:text-white transition-colors"
            >
              {NAV_SIGN_IN.label}
            </a>
            <a href={resolve(NAV_PRIMARY_CTA)} className="btn-primary px-4 py-2">
              {NAV_PRIMARY_CTA.label}
            </a>
          </div>

          {/* Mobile: keep the primary CTA visible alongside the menu toggle */}
          <div className="flex items-center gap-2 md:hidden">
            <a href={resolve(NAV_PRIMARY_CTA)} className="btn-primary px-3.5 py-2 text-[13px]">
              {NAV_PRIMARY_CTA.label}
            </a>
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
            {PRIMARY_NAV.map((item) => (
              <MobileNavItem key={item.label} item={item} onNavigate={() => setMobileOpen(false)} />
            ))}
            <div className="pt-3 mt-2 border-t border-hairline">
              <a
                href={resolve(NAV_SIGN_IN)}
                className="block px-3 py-2.5 text-sm font-semibold text-text-muted hover:text-text rounded-md transition-colors"
              >
                {NAV_SIGN_IN.label}
              </a>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

const linkClass =
  "px-3 py-2 text-sm font-medium text-text-muted rounded-md hover:text-text hover:bg-white/5 transition-colors";

function DesktopNavItem({
  item,
  open,
  onOpen,
  onClose,
}: {
  item: NavItem;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!isDropdown(item)) {
    return (
      <Link href={item.href} className={linkClass}>
        {item.label}
      </Link>
    );
  }

  // Close when focus leaves the whole dropdown (keyboard tab-out).
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) onClose();
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onBlur={onBlur}
    >
      <button
        type="button"
        className={`${linkClass} inline-flex items-center gap-1`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {item.label}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full pt-2">
          <ul className="min-w-[220px] card p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            {item.items.map((sub) => (
              <li key={sub.href}>
                <Link
                  href={sub.href}
                  className="block px-3 py-2 text-sm text-text-body rounded-md hover:text-text hover:bg-white/5 transition-colors"
                >
                  {sub.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MobileNavItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const itemClass =
    "block px-3 py-2.5 text-sm font-medium text-text-muted hover:text-text hover:bg-white/5 rounded-md transition-colors";

  if (!isDropdown(item)) {
    return (
      <Link href={item.href} onClick={onNavigate} className={itemClass}>
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <p className="px-3 pt-3 pb-1 pill-mono text-text-muted">{item.label}</p>
      {item.items.map((sub) => (
        <Link key={sub.href} href={sub.href} onClick={onNavigate} className={`${itemClass} pl-5`}>
          {sub.label}
        </Link>
      ))}
    </div>
  );
}
