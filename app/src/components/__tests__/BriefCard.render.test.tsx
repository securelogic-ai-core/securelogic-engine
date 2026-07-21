/**
 * BriefCard — entitlement + staleness contract (staging walkthrough defects,
 * 2026-07).
 *
 * Defect 1: a Platform Professional tenant whose engine response carried
 * locked issues was shown the consumer teaser — "Free preview", "Your free
 * brief includes", "Upgrade to Brief Pro — $49/mo". A platform tenant must
 * never receive Free-tier or Brief Pro upsell messaging; a locked issue in
 * that state renders a neutral unavailable card instead.
 *
 * Defect 2: the dashboard's Latest Brief fallback rendered a May-19 issue in
 * mid-July with no staleness indicator. On latest-brief surfaces
 * (showStaleWarning), an issue older than the weekly cadence window (+1 day
 * slack) must carry the shared amber age warning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { aNewsletterIssue } from "@/test/fixtures";
import { BriefCard } from "../BriefCard";

// The walkthrough's clock: latest issue published 2026-05-19, viewed 2026-07-15.
const WALKTHROUGH_TODAY = new Date("2026-07-15T12:00:00.000Z");

const STALE_ISSUE_DATES = {
  publish_date: "2026-05-19T00:00:00.000Z",
  created_at: "2026-05-19T00:00:00.000Z",
};

const FRESH_ISSUE_DATES = {
  publish_date: "2026-07-14T00:00:00.000Z", // yesterday
  created_at: "2026-07-14T00:00:00.000Z",
};

const UPSELL_STRINGS = [
  /Free preview/i,
  /Your free brief includes/i,
  /Available to Brief Pro and Team subscribers/i,
  /Upgrade to Brief Pro/i,
  /\$49\/mo/i,
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WALKTHROUGH_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BriefCard — a platform viewer never sees consumer upsells (defect 1)", () => {
  it("locked issue + platform viewer → neutral unavailable card, zero upsell strings", () => {
    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: true, audience_tier: "premium", ...STALE_ISSUE_DATES })}
        viewerIsPlatform
        showStaleWarning
      />
    );

    for (const upsell of UPSELL_STRINGS) {
      expect(screen.queryByText(upsell)).toBeNull();
    }
    // The neutral state: plain unavailability, plan reassurance, support path.
    expect(screen.getByText(/isn't available right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no upgrade is needed/i)).toBeInTheDocument();
    // No checkout/account-upgrade link either.
    expect(screen.queryByRole("link", { name: /upgrade/i })).toBeNull();
  });

  it("unlocked issue + platform viewer → the normal readable card", () => {
    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: false, ...FRESH_ISSUE_DATES })}
        viewerIsPlatform
        showStaleWarning
      />
    );
    expect(screen.getByText(/Read brief/)).toBeInTheDocument();
    for (const upsell of UPSELL_STRINGS) {
      expect(screen.queryByText(upsell)).toBeNull();
    }
  });
});

describe("BriefCard — staleness warning on latest-brief surfaces (defect 2)", () => {
  it("a stale unlocked issue carries the amber age warning with the publish date", () => {
    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: false, ...STALE_ISSUE_DATES })}
        showStaleWarning
      />
    );
    // 57 days old → floor(57/7) = 8 weeks — same label as the canonical card.
    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
    expect(screen.getByText(/briefs are published weekly/i)).toBeInTheDocument();
    expect(screen.getByText(/Last published May 19, 2026/)).toBeInTheDocument();
  });

  it("a stale issue drops its risk accent — no false claim of current urgency", () => {
    const { container } = render(
      <BriefCard
        issue={aNewsletterIssue({ locked: false, ...STALE_ISSUE_DATES })}
        showStaleWarning
      />
    );
    expect(container.querySelector(".border-l-red-500")).toBeNull();
    expect(container.querySelector(".border-l-orange-400")).toBeNull();
  });

  it("a current issue shows NO staleness warning", () => {
    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: false, ...FRESH_ISSUE_DATES })}
        showStaleWarning
      />
    );
    expect(screen.queryByText(/weeks old|days old/)).toBeNull();
  });

  it("the stale warning also reaches locked and platform-unavailable variants", () => {
    const { unmount } = render(
      <BriefCard
        issue={aNewsletterIssue({ locked: true, ...STALE_ISSUE_DATES })}
        showStaleWarning
      />
    );
    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
    unmount();

    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: true, ...STALE_ISSUE_DATES })}
        viewerIsPlatform
        showStaleWarning
      />
    );
    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
  });

  it("archive surfaces (no showStaleWarning) never warn — old issues are just the archive", () => {
    render(<BriefCard issue={aNewsletterIssue({ locked: false, ...STALE_ISSUE_DATES })} />);
    expect(screen.queryByText(/weeks old|days old/)).toBeNull();
  });
});

describe("BriefCard — Free/Brief-only plans keep their experience", () => {
  it("locked issue + non-platform viewer → the value-demonstrating teaser with upsell", () => {
    render(
      <BriefCard
        issue={aNewsletterIssue({ locked: true, audience_tier: "standard", ...FRESH_ISSUE_DATES })}
      />
    );
    expect(screen.getByText(/Free preview/)).toBeInTheDocument();
    expect(screen.getByText(/Your free brief includes/)).toBeInTheDocument();
    expect(screen.getByText(/Available to Brief Pro and Team subscribers/)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Brief Pro — \$49\/mo/)).toBeInTheDocument();
    // And no false "unavailable" framing — the content is working as designed.
    expect(screen.queryByText(/isn't available right now/i)).toBeNull();
  });
});
