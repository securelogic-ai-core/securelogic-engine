"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface NavProps {
  appUrl: string;
}

export function Nav({ appUrl }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-navy-900 border-b border-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.06),0_4px_24px_rgba(0,0,0,0.5)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0 flex items-center gap-2.5">
            <Image
              src="/branding/securelogic-ai-logo.png"
              alt="SecureLogic AI"
              width={36}
              height={36}
              className="h-9 w-9 rounded-xl flex-shrink-0"
            />
            <span className="text-white font-semibold text-[15px] leading-none tracking-tight">
              SecureLogic AI
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/platform/"
              className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-md hover:bg-slate-800/60 transition-colors"
            >
              Platform
            </Link>
            <Link
              href="/intelligence-brief/"
              className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-md hover:bg-slate-800/60 transition-colors"
            >
              Intelligence Brief
            </Link>
            <Link
              href="/pricing/"
              className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-md hover:bg-slate-800/60 transition-colors"
            >
              Pricing
            </Link>
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href={`${appUrl}/login`}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Log in
            </a>
            <a
              href={`${appUrl}/register`}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 transition-colors shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]"
            >
              Get started
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-slate-800 py-3 space-y-1">
            <Link
              href="/platform/"
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-md"
            >
              Platform
            </Link>
            <Link
              href="/intelligence-brief/"
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-md"
            >
              Intelligence Brief
            </Link>
            <Link
              href="/pricing/"
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-md"
            >
              Pricing
            </Link>
            <div className="pt-3 flex flex-col gap-2 border-t border-slate-800 mt-2">
              <a
                href={`${appUrl}/login`}
                className="block px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 rounded-md"
              >
                Log in
              </a>
              <a
                href={`${appUrl}/register`}
                className="block px-3 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 rounded-md text-center"
              >
                Get started
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
