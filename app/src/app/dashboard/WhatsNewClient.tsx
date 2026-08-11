"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dismissBannerAction } from "@/app/actions/dismissBanner";
import type { WhatsNewRelease } from "@/lib/whatsNew";

/**
 * WhatsNewClient — the interactive shell for the release panel.
 *
 * TWO DISMISSAL SEMANTICS, DELIBERATELY DIFFERENT:
 *
 *   "Got it"     — permanent. Persists the banner key via the existing
 *                  POST /api/me/dismiss-banner mechanism, so it stays gone
 *                  across sessions and devices.
 *   "Show later" — this visit only. Pure client state; nothing is written. The
 *                  panel returns on the next page load.
 *
 * A single "dismiss" would force the customer to choose between reading it now
 * and losing it forever — the exact friction the orientation exists to remove.
 *
 * Uses the click + startTransition idiom rather than a React 19 form action:
 * jsdom has no requestSubmit(), so form actions are untestable in this suite.
 * This matches DismissBannerButton, the sibling that established the pattern.
 */
export function WhatsNewClient({ release }: { release: WhatsNewRelease }) {
  const router = useRouter();
  const [hiddenForNow, setHiddenForNow] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (hiddenForNow) return null;

  return (
    <section
      aria-labelledby="whats-new-heading"
      className="mb-6 rounded-xl px-5 py-4"
      style={{
        background: "rgba(45,212,191,0.05)",
        border: "1px solid rgba(45,212,191,0.22)",
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p
            id="whats-new-heading"
            className="text-sm font-semibold mb-1"
            style={{ color: "#2dd4bf" }}
          >
            {release.headline}
          </p>
          <p className="text-xs mb-0" style={{ color: "#94a3b8" }}>
            {release.intro}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3 list-none pl-0">
        {release.items.map((item) => (
          <li key={item.id}>
            <p className="text-xs font-semibold mb-0.5" style={{ color: "#e2e8f0" }}>
              {item.title}
            </p>
            {/* "Why this changed" — our intent, stated plainly. */}
            <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
              {item.why}
            </p>
            <Link
              href={item.href}
              className="text-xs font-semibold"
              style={{ color: "#2dd4bf" }}
            >
              {item.hrefLabel} →
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await dismissBannerAction(release.bannerKey);
              router.refresh();
            })
          }
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{
            background: "#0d9488",
            color: "white",
            border: "none",
            cursor: isPending ? "wait" : "pointer",
          }}
        >
          Got it
        </button>
        <button
          type="button"
          onClick={() => setHiddenForNow(true)}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{
            background: "transparent",
            color: "#94a3b8",
            border: "1px solid rgba(148,163,184,0.3)",
            cursor: "pointer",
          }}
        >
          Show later
        </button>
      </div>
    </section>
  );
}
