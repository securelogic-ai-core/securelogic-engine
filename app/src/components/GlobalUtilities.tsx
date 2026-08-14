"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * GlobalUtilities — the header's upper-right utility cluster.
 *
 * The IA rule (pre-September-15 UX/IA refinement): primary navigation is
 * WORKSPACES; Search ("find") and Ask SecureLogic ("understand / analyze /
 * interact") are utilities that belong to no workspace because they operate
 * across all of them. They therefore live here — beside the profile control, in
 * the upper right, at EVERY breakpoint and in BOTH nav models — instead of
 * competing with workspaces for a slot in the primary menu (Search) or hiding
 * inside the account dropdown (Ask).
 *
 * What did NOT change: the destinations, their authorization, and their
 * behavior. Search posts to the SAME canonical `/search` page with the SAME `q`
 * parameter — this is an entry point to the one search implementation, not a
 * second one — and Ask is the same `/ask` route with the same entitlement and
 * feature-flag semantics. Visibility mirrors the platform gating both entries
 * carried as nav items (`GLOBAL_UTILITY_ITEMS` in `lib/navigation.ts` declares
 * the same access to the Application Knowledge Index).
 *
 * The search form is a plain GET form: it works with no client JS, exactly like
 * the form on the /search page itself. Below `xl` the field collapses to an
 * icon link to /search, whose own input autofocuses — so the utility stays
 * usable on tablet without crowding the workspace nav.
 */

const IDLE = "#cbd5e1";
const ACTIVE = "#00c4b4";

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

const ICON_BUTTON_CLASS =
  "flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/5";

interface Props {
  /** Render the global Search control (platform-tier, as the nav entry was). */
  showSearch: boolean;
  /** Render the global Ask SecureLogic action (platform-tier, as before). */
  showAsk: boolean;
}

export function GlobalUtilities({ showSearch, showAsk }: Props) {
  const pathname = usePathname() ?? "";
  if (!showSearch && !showAsk) return null;

  const searchActive = pathname === "/search";
  const askActive = pathname === "/ask" || pathname.startsWith("/ask/");

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {showSearch && (
        <>
          {/* Desktop: the field itself. GET → the canonical /search page. */}
          <form action="/search" method="get" role="search" className="hidden xl:block">
            <input
              type="search"
              name="q"
              minLength={2}
              maxLength={200}
              placeholder="Search everything…"
              aria-label="Search your organization"
              className="w-44 px-3 py-1.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-teal-600"
              style={{ background: "#0f172a", border: "1px solid #1e293b" }}
            />
          </form>

          {/* Tablet / mobile: the same destination, one tap. */}
          <Link
            href="/search"
            aria-label="Search"
            title="Search"
            className={`xl:hidden ${ICON_BUTTON_CLASS}`}
            style={{ color: searchActive ? ACTIVE : IDLE }}
          >
            <SearchIcon />
          </Link>
        </>
      )}

      {showAsk && (
        <Link
          href="/ask"
          aria-label="Ask SecureLogic"
          title="Ask SecureLogic"
          className="flex items-center gap-2 rounded-lg px-2 h-8 text-sm font-medium transition-colors hover:bg-white/5"
          style={{ color: askActive ? ACTIVE : IDLE }}
        >
          <AskIcon />
          <span className="hidden xl:inline whitespace-nowrap">Ask SecureLogic</span>
        </Link>
      )}
    </div>
  );
}

export default GlobalUtilities;
