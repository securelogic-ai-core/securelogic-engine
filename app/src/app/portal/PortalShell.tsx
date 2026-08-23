"use client";

/**
 * PortalShell — the client frame around every external vendor-portal screen.
 *
 * Responsibilities:
 *  - fetch GET /api/vendor-portal/engagement once per mount and share it with
 *    every screen (who is asking, engagement state, write-window flags);
 *  - render the portal's own minimal header: organization name + "Vendor
 *    Assurance Portal" + vendor/engagement name. No internal app nav, no
 *    links into the app;
 *  - handle the missing/expired-session state uniformly: there is NO login
 *    form on this surface — the only way in is the emailed link, and every
 *    screen says so the same way;
 *  - skip all of the above on /portal/accept/* — the accept page runs BEFORE
 *    a session exists.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { portalFetch, statusLabel, type PortalEngagement } from "./portalApi";

type ShellStatus = "loading" | "ready" | "session_required" | "unavailable" | "error";

type PortalContextValue = {
  engagement: PortalEngagement | null;
  /** Re-read the engagement (after submit, the status header must update). */
  reloadEngagement: () => Promise<void>;
  /** Any screen that sees a 401 from its own fetch calls this. */
  onUnauthorized: () => void;
};

const PortalContext = createContext<PortalContextValue>({
  engagement: null,
  reloadEngagement: async () => {},
  onUnauthorized: () => {},
});

export function usePortal(): PortalContextValue {
  return useContext(PortalContext);
}

// ── Shared full-page states ─────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-bg text-slate-100">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}

function BrandRow({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-8 flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/securelogic-ai-icon.png"
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        className="rounded-md"
      />
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-100">SecureLogic AI</div>
        <div className="text-xs uppercase tracking-wide text-slate-400">
          {subtitle ?? "Vendor Assurance Portal"}
        </div>
      </div>
    </div>
  );
}

/**
 * The uniform "no session" state. Deliberately not a login form: access to
 * this portal is only ever granted through the emailed link.
 */
export function SessionRequiredNotice() {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
      <h1 className="text-xl font-semibold text-slate-100">Secure link required</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        This portal can only be opened through the secure link you received by email. Your
        session may have expired — sessions end after 12 hours of inactivity.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Please open the link from your invitation email again. If the link no longer works,
        ask your contact at the requesting organization to send a new one.
      </p>
    </div>
  );
}

function UnavailableNotice() {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
      <h1 className="text-xl font-semibold text-slate-100">Portal unavailable</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        The vendor assurance portal is not available right now. Please try again later, or
        contact the organization that sent you the request.
      </p>
    </div>
  );
}

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
      <h1 className="text-xl font-semibold text-slate-100">Something went wrong</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We could not load your assessment request. Your answers are saved as you go, so
        nothing has been lost.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

// ── Portal navigation (within the portal only) ──────────────────────────────

const PORTAL_TABS: Array<{ href: string; label: string }> = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/questionnaire", label: "Questionnaire" },
  // VA-D1. Next to the questionnaire because "what am I supposed to answer" is
  // the question people ask immediately after opening it.
  { href: "/portal/work", label: "Work" },
  { href: "/portal/evidence", label: "Attachments" },
  { href: "/portal/clarifications", label: "Messages" },
  // VA-P1. Placed before "Review & submit" because deciding who else should
  // answer happens while the work is in progress, not at the end.
  { href: "/portal/team", label: "Your team" },
  { href: "/portal/review", label: "Review & submit" },
];

function PortalTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Portal sections"
      className="mb-8 flex flex-wrap gap-1 border-b border-brand-line pb-px"
    >
      {PORTAL_TABS.map((tab) => {
        const active =
          tab.href === "/portal" ? pathname === "/portal" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "rounded-t-md px-3 py-2 text-sm font-medium transition-colors " +
              (active
                ? "border-b-2 border-brand-teal text-brand-teal"
                : "text-slate-400 hover:text-slate-200")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAcceptRoute = pathname.startsWith("/portal/accept");

  const [status, setStatus] = useState<ShellStatus>("loading");
  const [engagement, setEngagement] = useState<PortalEngagement | null>(null);

  const loadEngagement = useCallback(async () => {
    try {
      const result = await portalFetch<PortalEngagement>("/engagement");
      if (result.status === 401) {
        setStatus("session_required");
        return;
      }
      if (result.status === 404) {
        // The engine feature flag is off — the whole surface answers 404.
        setStatus("unavailable");
        return;
      }
      if (!result.ok || !result.body) {
        setStatus("error");
        return;
      }
      setEngagement(result.body as PortalEngagement);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (isAcceptRoute) return;
    void loadEngagement();
  }, [isAcceptRoute, loadEngagement]);

  const onUnauthorized = useCallback(() => setStatus("session_required"), []);

  // The accept page manages its own copy — no session exists yet.
  if (isAcceptRoute) {
    return (
      <Frame>
        <BrandRow />
        {children}
      </Frame>
    );
  }

  if (status === "loading") {
    return (
      <Frame>
        <BrandRow />
        <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-sm text-slate-400">
          Loading your assessment request…
        </div>
      </Frame>
    );
  }

  if (status === "session_required") {
    return (
      <Frame>
        <BrandRow />
        <SessionRequiredNotice />
      </Frame>
    );
  }

  if (status === "unavailable") {
    return (
      <Frame>
        <BrandRow />
        <UnavailableNotice />
      </Frame>
    );
  }

  if (status === "error" || !engagement) {
    return (
      <Frame>
        <BrandRow />
        <ErrorNotice onRetry={() => void loadEngagement()} />
      </Frame>
    );
  }

  return (
    <PortalContext.Provider
      value={{ engagement, reloadEngagement: loadEngagement, onUnauthorized }}
    >
      <Frame>
        <BrandRow subtitle={`Vendor Assurance Portal — ${engagement.organization_name}`} />
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-100">
            {engagement.title ?? "Security & compliance assessment"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            <span className="font-medium text-slate-300">{engagement.organization_name}</span>{" "}
            has asked{" "}
            <span className="font-medium text-slate-300">{engagement.vendor_name}</span> to
            complete this assessment.
            <span className="ml-2 inline-block rounded-full border border-brand-line bg-brand-bg px-2 py-0.5 text-xs font-medium text-slate-300">
              {statusLabel(engagement.status)}
            </span>
          </p>
        </header>
        <PortalTabs />
        {children}
      </Frame>
    </PortalContext.Provider>
  );
}
