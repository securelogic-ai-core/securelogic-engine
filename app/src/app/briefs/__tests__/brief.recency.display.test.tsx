/**
 * IQP Q2 / IQ-1 A3 — the Brief's date-honesty render contract.
 *
 * Staging evidence (2026-08-07, [SEED] Walkthrough Org): the Jul 26 – Aug 2
 * brief presented CVE-2010-0188 (2010) and CVE-2002-0367 (2002) as "this
 * period", with no visible date on any item. Recency ENFORCEMENT is the
 * engine's job (SECURELOGIC_SIGNAL_RECENCY_ENABLED); this file pins the
 * display half: the reader can always see (a) the window the brief claims to
 * cover, and (b) the date the source itself asserts for each item — so stale
 * intelligence can never silently appear current.
 *
 * Kept separate from brief.render.test.tsx so this lands without overlapping
 * the EUX-1 hunks open in PR #748.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn } from "@/test/harness";
import {
  aMe,
  aNewsletterIssue,
  anIntelligenceBrief,
  anIntelligenceBriefItem,
  anIssuesResponse,
} from "@/test/fixtures";

vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
);

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getIssues: vi.fn(),
  getIssue: vi.fn(),
  getIntelligenceBrief: vi.fn(),
  getIntelligenceBriefs: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import BriefDetailPage from "../[id]/page";
import ItemDetailPage from "../[id]/signal/item/[index]/page";

const params = <T extends Record<string, string>>(p: T) => Promise.resolve(p);

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));
  api.getIssues.mockResolvedValue(anIssuesResponse([aNewsletterIssue()]));
  api.getIssue.mockResolvedValue(null);
  api.getIntelligenceBrief.mockResolvedValue(null);
  api.getIntelligenceBriefs.mockResolvedValue(null);
});

describe("/briefs/[id] — the masthead states the coverage window", () => {
  it("shows the full period, UTC-pinned, not just the end date", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([anIntelligenceBriefItem()])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });
    const text = container.textContent ?? "";

    // Fixture period: 2026-05-25 → 2026-06-01. Both ends, en dash between.
    expect(text).toContain("May 25, 2026 – Jun 1, 2026");
  });
});

describe("brief item cards — the source's own event date", () => {
  it("an item with signal_published_at shows 'Reported {date}' (UTC-pinned)", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({
          id: "item-old",
          title: "Adobe Reader Arbitrary Code Execution",
          affected_cve: "CVE-2010-0188",
          signal_published_at: "2010-03-01T00:00:00.000Z",
        }),
      ])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    // The 2010 date is visible on the card — the reader is TOLD it is old.
    expect(container.textContent).toContain("Reported Mar 1, 2010");
  });

  it("an item without a source date shows NO date — never inferred, never substituted", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({ id: "item-nodate", signal_published_at: null }),
      ])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    expect(container.textContent).not.toContain("Reported");
  });

  it("older engine payloads (field absent) render exactly as before", async () => {
    const item = anIntelligenceBriefItem({ id: "item-legacy" });
    delete (item as Record<string, unknown>)["signal_published_at"];
    api.getIntelligenceBrief.mockResolvedValue(anIntelligenceBrief([item]));

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    expect(container.textContent).not.toContain("Reported");
  });
});

describe("brief item cards — the window-contradiction note (W0 / EDX-8)", () => {
  it("a source date years before the coverage window is disclosed in words, not left to arithmetic", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({
          id: "item-old",
          affected_cve: "CVE-2010-0188",
          signal_published_at: "2010-03-01T00:00:00.000Z",
        }),
      ])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    // Fixture window starts 2026-05-25; the item is from 2010.
    expect(container.textContent).toContain(
      "Reported 16 years before this brief’s coverage window."
    );
  });

  it("a source date inside the window (or within the grace period) renders no note", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({
          id: "item-fresh",
          signal_published_at: "2026-05-28T00:00:00.000Z",
        }),
        anIntelligenceBriefItem({
          id: "item-grace",
          signal_published_at: "2026-05-01T00:00:00.000Z",
        }),
      ])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    expect(container.textContent).not.toContain("coverage window");
  });

  it("an item without a source date gets no note — a contradiction is never asserted from absence", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({ id: "item-nodate", signal_published_at: null }),
      ])
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "brief-1" }),
    });

    expect(container.textContent).not.toContain("coverage window");
  });
});

describe("item detail — the Source section carries the Reported row", () => {
  it("renders 'Reported' beside 'Ingested' when the source asserted a date", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({
          signal_published_at: "2010-03-01T00:00:00.000Z",
          ingestion_timestamp: "2026-07-30T00:00:00.000Z",
        }),
      ])
    );

    await renderPage(ItemDetailPage, {
      params: params({ id: "brief-1", index: "0" }),
    });

    expect(screen.getByText("Reported")).toBeInTheDocument();
    expect(screen.getByText("March 1, 2010")).toBeInTheDocument();
    expect(screen.getByText("Ingested")).toBeInTheDocument();
  });

  it("discloses the window contradiction beside the Reported date (W0 / EDX-8)", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([
        anIntelligenceBriefItem({
          signal_published_at: "2010-03-01T00:00:00.000Z",
          ingestion_timestamp: "2026-07-30T00:00:00.000Z",
        }),
      ])
    );

    const { container } = await renderPage(ItemDetailPage, {
      params: params({ id: "brief-1", index: "0" }),
    });

    expect(container.textContent).toContain(
      "Reported 16 years before this brief’s coverage window."
    );
  });
});
