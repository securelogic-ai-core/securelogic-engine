/**
 * W0 (Brief content integrity) — the legacy BriefReader renders STORED
 * analysis or an honest absence, never client-side synthesis.
 *
 * Before this pass, an archived issue with no stored summary rendered
 * templated reassurance ("No escalation this week … within normal range")
 * styled as the executive summary, and an issue whose signals carried no
 * tier/risk data still displayed a "Monitor" posture verdict — machine
 * sentences and verdicts presented as analyst output on historical records.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderPage, signedIn } from "@/test/harness";
import {
  aMe,
  aNewsletterIssue,
  aBriefSignal,
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

const params = <T extends Record<string, string>>(p: T) => Promise.resolve(p);

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));
  api.getIssues.mockResolvedValue(anIssuesResponse([aNewsletterIssue()]));
  api.getIntelligenceBrief.mockResolvedValue(null);
  api.getIntelligenceBriefs.mockResolvedValue(null);
});

describe("legacy BriefReader — executive summary is stored analysis or honest absence", () => {
  it("a stored summary renders verbatim", async () => {
    api.getIssue.mockResolvedValue(aNewsletterIssue());

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "issue-1" }),
    });

    expect(container.textContent).toContain("Two items need a decision this week.");
  });

  it("a missing summary says so — no templated reassurance is synthesized", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        summary: null,
        thesis_headline: null,
        // A signal with NO tier/risk data — nothing to derive a verdict from.
        sections_json: {
          securityIncidents: [
            aBriefSignal({ riskLevel: "", priorityTier: undefined }),
          ],
        },
      })
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "issue-1" }),
    });
    const text = container.textContent ?? "";

    expect(text).toContain("No executive summary was recorded for this issue.");
    // The retired synthesized templates must never reappear.
    expect(text).not.toContain("No escalation this week");
    expect(text).not.toContain("within normal range");
    expect(text).not.toContain("Review the priority items below");
  });
});

describe("legacy BriefReader — the posture verdict needs a basis", () => {
  it("signals without tier or risk data produce NO posture chip — absence is not 'Monitor'", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        summary: null,
        sections_json: {
          securityIncidents: [
            aBriefSignal({ riskLevel: "", priorityTier: undefined }),
          ],
        },
      })
    );

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "issue-1" }),
    });

    expect(container.textContent).not.toContain("Monitor");
    expect(container.textContent).not.toContain("Act Now");
    expect(container.textContent).not.toContain("Watch Closely");
  });

  it("a critical signal still derives 'Act Now' — real data keeps its rollup", async () => {
    api.getIssue.mockResolvedValue(aNewsletterIssue());

    const { container } = await renderPage(BriefDetailPage, {
      params: params({ id: "issue-1" }),
    });

    expect(container.textContent).toContain("Act Now");
  });
});
