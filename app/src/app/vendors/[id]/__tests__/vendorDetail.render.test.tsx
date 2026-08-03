/**
 * /vendors/[id] — the vendor detail render contract.
 *
 * A detail page is the sharpest tenant-isolation surface in the product: it is addressed
 * by a raw id from the URL bar. The engine is the authority — it returns null for a
 * vendor that belongs to another org (403/404). The ONLY safe render for null is no
 * render at all. These tests hold that line, and they hold the linkage #617 wired in:
 * every related object on this page (findings, dependent AI systems, matched signals,
 * assurance documents) must be fetched SCOPED TO THIS VENDOR and must deep-link to a
 * destination that exists.
 *
 * The page reads no feature flag — there is no flag branch to cover here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import {
  aFramework,
  aVendor,
  aVendorAssessment,
  aVendorAssessmentsResponse,
  aVendorAiDependency,
  aVendorAssuranceDocument,
  aVendorAssuranceExtractionResponse,
  aVendorFinding,
  aVendorReview,
  aVendorReviewsResponse,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getVendor: vi.fn(),
  getVendorAssessmentsForVendor: vi.fn(),
  getVendorReviews: vi.fn(),
  getVendorFindings: vi.fn(),
  getVendorSignals: vi.fn(),
  getVendorAiDependencies: vi.fn(),
  listVendorAssuranceDocuments: vi.fn(),
  getVendorAssuranceExtraction: vi.fn(),
  getFrameworks: vi.fn(),
  getFrameworkRequirements: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

// The client sections import server actions, which import next/cache — no request scope
// in a test process. They are rendered as handlers here, never invoked.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import VendorDetailPage from "../page";

const props = (id = "v-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getVendor.mockResolvedValue(aVendor());
  api.getVendorAssessmentsForVendor.mockResolvedValue(aVendorAssessmentsResponse([]));
  api.getVendorReviews.mockResolvedValue(aVendorReviewsResponse([]));
  api.getVendorFindings.mockResolvedValue({ findings: [], total: 0 });
  api.getVendorSignals.mockResolvedValue([]);
  api.getVendorAiDependencies.mockResolvedValue([]);
  api.listVendorAssuranceDocuments.mockResolvedValue({ documents: [] });
  api.getVendorAssuranceExtraction.mockResolvedValue(null);
  api.getFrameworks.mockResolvedValue({ frameworks: [] });
  api.getFrameworkRequirements.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────
// 1. The record the engine returned for THIS id — and nothing else
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — the correct, tenant-scoped record", () => {
  it("asks the engine for the id in the URL and renders that vendor", async () => {
    api.getVendor.mockResolvedValue(aVendor({ id: "v-9", name: "Zenith Payments" }));

    await renderPage(VendorDetailPage, props("v-9"));

    expect(api.getVendor).toHaveBeenCalledWith("test-jwt", "v-9");
    expect(
      screen.getByRole("heading", { level: 1, name: "Zenith Payments" })
    ).toBeInTheDocument();
  });

  it("a vendor the caller may NOT see renders NOTHING — no shell, no empty-but-plausible page", async () => {
    // A vendor in another org (or a deleted one) comes back from the engine as null.
    // The related collections still resolve — an empty list from a 403 is indistinguishable
    // from an empty list from an empty vendor — so a page that rendered "around" the null
    // would show a fully-formed vendor detail with zero counts, for a record the caller has
    // no right to know exists. The honest outcome is the list page.
    api.getVendor.mockResolvedValue(null);
    api.getVendorFindings.mockResolvedValue({ findings: [aVendorFinding()], total: 1 });
    api.getVendorAiDependencies.mockResolvedValue([aVendorAiDependency()]);

    expect(await expectRedirect(VendorDetailPage, props("v-other-org"))).toBe("/vendors");
  });

  it("renders ONLY the fetched vendor's own attributes — never an org-wide fallback", async () => {
    api.getVendor.mockResolvedValue(
      aVendor({
        id: "v-1",
        name: "Acme Cloud",
        service_description: "Managed object storage.",
        criticality: "critical",
        current_risk_score: 18,
        category: "Infrastructure",
      })
    );

    const { container } = await renderPage(VendorDetailPage, props());

    expect(screen.getByRole("heading", { level: 1, name: "Acme Cloud" })).toBeInTheDocument();
    expect(screen.getByText("Managed object storage.")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Infrastructure")).toBeInTheDocument();
    // The risk score is the VENDOR's, banded from the vendor's own score.
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("Critical Risk")).toBeInTheDocument();
    // An unscored vendor is honestly unscored — never a fabricated zero (see below).
    expect(container.textContent).not.toContain("No score yet");
  });

  it("an UNSCORED vendor shows an em-dash and a next step — not a 0 that reads as clean", async () => {
    api.getVendor.mockResolvedValue(aVendor({ current_risk_score: null }));

    const { container } = await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText("No score yet — create an assessment to compute")
    ).toBeInTheDocument();
    // "0" here would read as "worst possible risk" on this scale — the opposite of unknown.
    expect(container.textContent).not.toContain("Critical Risk");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Every related collection is fetched SCOPED TO THIS VENDOR
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — no cross-org, no cross-entity fill", () => {
  it("fetches findings, signals, dependencies and assurance docs scoped to this vendor", async () => {
    api.listVendorAssuranceDocuments.mockResolvedValue({
      documents: [aVendorAssuranceDocument({ id: "doc-1" })],
    });
    api.getVendorAssuranceExtraction.mockResolvedValue(aVendorAssuranceExtractionResponse());

    await renderPage(VendorDetailPage, props("v-1"));

    // Each related read carries the vendor id. An unscoped read here would fill a
    // vendor page with the org's other vendors' work.
    expect(api.getVendorFindings).toHaveBeenCalledWith("test-jwt", "v-1");
    expect(api.getVendorSignals).toHaveBeenCalledWith("test-jwt", "v-1", 10);
    expect(api.getVendorAiDependencies).toHaveBeenCalledWith("test-jwt", "v-1");
    expect(api.getVendorAssessmentsForVendor).toHaveBeenCalledWith("test-jwt", "v-1", 20);
    expect(api.getVendorReviews).toHaveBeenCalledWith("test-jwt", "v-1", 20);

    // getVendorReviews' vendorId is OPTIONAL — calling it without one returns the whole
    // org's review cycles. The vendor id must always be present.
    expect(api.getVendorReviews.mock.calls[0][1]).toBe("v-1");

    // Assurance documents are listed BY VENDOR and by finalized status, never org-wide,
    // and the extraction is read for the document that list returned.
    expect(api.listVendorAssuranceDocuments).toHaveBeenCalledWith("test-jwt", {
      vendorId: "v-1",
      status: "finalized",
      limit: 1,
    });
    expect(api.getVendorAssuranceExtraction).toHaveBeenCalledWith("test-jwt", "doc-1");
  });

  it("the token on every read is the CALLER's — the engine's org scope rides on it", async () => {
    signedIn({ jwtToken: "caller-token" });

    await renderPage(VendorDetailPage, props("v-1"));

    for (const fn of [
      api.getVendor,
      api.getVendorFindings,
      api.getVendorSignals,
      api.getVendorAiDependencies,
      api.listVendorAssuranceDocuments,
    ]) {
      expect(fn.mock.calls[0][0]).toBe("caller-token");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Canonical linkage: findings, intelligence, dependent AI systems
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — related findings", () => {
  it("renders the vendor's ACTIVE findings with real labels and their source assessment", async () => {
    api.getVendorFindings.mockResolvedValue({
      findings: [
        aVendorFinding({
          id: "f-1",
          title: "Unencrypted backups in eu-west-1",
          severity: "Critical",
          status: "open",
          assessment_type: "annual_review",
        }),
        aVendorFinding({
          id: "f-2",
          title: "No breach-notification clause",
          severity: "High",
          status: "in_progress",
          assessment_type: "pre_contract",
        }),
      ],
      total: 2,
    });

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
    expect(screen.getByText("No breach-notification clause")).toBeInTheDocument();
    // The assessment type is rendered as a HUMAN label, not the raw enum.
    expect(screen.getByText(/Annual Review/)).toBeInTheDocument();
    expect(screen.getByText(/Pre-Contract Due Diligence/)).toBeInTheDocument();
    expect(screen.queryByText(/pre_contract/)).toBeNull();
  });

  it("closed findings are excluded from Active Findings — and from the count beside it", async () => {
    api.getVendorFindings.mockResolvedValue({
      findings: [
        aVendorFinding({ id: "f-1", title: "Still open", status: "open" }),
        aVendorFinding({ id: "f-2", title: "Already fixed", status: "closed" }),
      ],
      total: 2,
    });

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText("Still open")).toBeInTheDocument();
    expect(screen.queryByText("Already fixed")).toBeNull();
    // The sidebar count is the same population as the list — one number, one truth.
    const activeFindingsRow = screen.getByText("Active findings").parentElement as HTMLElement;
    expect(activeFindingsRow.textContent).toContain("1");
  });

  it("a vendor with NO findings renders an honest empty state, not a fabricated row", async () => {
    api.getVendorFindings.mockResolvedValue({ findings: [], total: 0 });

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText(/No active findings for this vendor/)).toBeInTheDocument();
  });

  it("an engine failure on findings is not rendered as 'no findings'… (documented behavior)", async () => {
    // getVendorFindings returns null on a non-OK response. The page coalesces that to []
    // and shows "No active findings" — a resolver failure rendered as an honest zero.
    // Asserted here so the behavior is VISIBLE and cannot change unnoticed; see the
    // report accompanying this suite.
    api.getVendorFindings.mockResolvedValue(null);

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText(/No active findings for this vendor/)).toBeInTheDocument();
  });
});

describe("/vendors/[id] — live intelligence and the AI systems that depend on this vendor", () => {
  it("linked signals render dated, sourced, and drillable — with a real reassess route", async () => {
    api.getVendorSignals.mockResolvedValue([
      {
        link_id: "svl-1",
        link_created_at: "2026-07-20T00:00:00.000Z",
        id: "sig-1",
        source: "cisa-kev",
        signal_type: "vulnerability",
        severity: "Critical",
        normalized_summary: "Actively exploited RCE in Acme Cloud Gateway",
        affected_vendor: "Acme Cloud",
        affected_cve: "CVE-2026-1234",
        ingestion_timestamp: "2026-07-19T00:00:00.000Z",
        intelligence_event_id: "evt-9",
        event_summary: null,
      },
    ]);

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    // Deterministic evidence: the signal's own summary, its CVE, and the date
    // the link was accepted — not an unlinked LLM paraphrase.
    expect(
      screen.getByText("Actively exploited RCE in Acme Cloud Gateway")
    ).toBeInTheDocument();
    expect(screen.getByText("CVE-2026-1234")).toBeInTheDocument();
    expect(screen.getByText(/linked Jul 20, 2026/)).toBeInTheDocument();
    expect(hrefOf(container, /View intelligence event/)).toBe("/intelligence/evt-9");
    expect(hrefOf(container, /Reassess with this intelligence/)).toBe("/vendors/v-1/assess");
  });

  it("no linked signals: a guiding empty state that routes to the review queue — and NO reassess link to nothing", async () => {
    api.getVendorSignals.mockResolvedValue([]);

    const { container } = await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText(/No confirmed external signals are linked to this vendor/i)
    ).toBeInTheDocument();
    // The way out is the confirmation queue, pre-filtered to vendor targets.
    expect(hrefOf(container, /review queue/)).toContain("/queue?target_type=vendor");
    expect(hrefOf(container, /Reassess with this intelligence/)).toBeNull();
  });

  it("an intelligence-read outage does not invent a clean vendor", async () => {
    // getVendorSignals returns null when the engine is unreachable — the section
    // says so explicitly instead of rendering the zero-signals state.
    api.getVendorSignals.mockResolvedValue(null);

    await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText(/does not mean the vendor is clear/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No confirmed external signals are linked/i)
    ).toBeNull();
  });

  it("dependent AI systems deep-link to the AI system that actually exists", async () => {
    api.getVendorAiDependencies.mockResolvedValue([
      aVendorAiDependency({
        dependency_id: "dep-1",
        ai_system_id: "ai-77",
        ai_system_name: "Claims Triage Copilot",
        dependency_role: "model_provider",
      }),
    ]);

    const { container } = await renderPage(VendorDetailPage, props());

    expect(screen.getByText("Dependent AI Systems (1)")).toBeInTheDocument();
    // The link lands on the real AI-system detail route, carrying the id the engine gave.
    expect(hrefOf(container, "Claims Triage Copilot")).toBe("/ai-systems/ai-77");
    // The role is a human label, not the raw enum.
    expect(screen.getByText("Model provider")).toBeInTheDocument();
  });

  it("no dependent AI systems: the card says so and links only to the AI inventory, never a fabricated system", async () => {
    api.getVendorAiDependencies.mockResolvedValue([]);

    const { container } = await renderPage(VendorDetailPage, props());

    expect(screen.getByText("Dependent AI Systems (0)")).toBeInTheDocument();
    expect(
      screen.getByText(/No AI systems record a dependency on this vendor/)
    ).toBeInTheDocument();
    // Guidance links to the inventory LIST; no per-system deep link may exist
    // (there is no system to link to).
    expect(hrefs(container)).toContain("/ai-systems");
    expect(hrefs(container).some((h) => h.startsWith("/ai-systems/"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Every link is a real destination
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — links land somewhere real", () => {
  it("the action rail routes to this vendor's own workflows", async () => {
    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    expect(hrefOf(container, "New Assessment")).toBe("/vendors/v-1/assess");
    expect(hrefOf(container, "New Review Cycle")).toBe("/vendors/v-1/review");
    expect(hrefOf(container, "Add Finding")).toBe("/vendors/v-1/findings/new");
    expect(hrefOf(container, "Assess Against Framework")).toBe("/vendors/v-1/assess/framework");
    expect(hrefOf(container, "Edit Vendor")).toBe("/vendors/v-1/edit");
    expect(hrefOf(container, "Vendors")).toBe("/vendors");
  });

  it("no dead links anywhere on the page: no '#', no empty href, no undefined id", async () => {
    api.getVendorFindings.mockResolvedValue({ findings: [aVendorFinding()], total: 1 });
    api.getVendorAiDependencies.mockResolvedValue([aVendorAiDependency()]);
    api.getVendorAssessmentsForVendor.mockResolvedValue(
      aVendorAssessmentsResponse([aVendorAssessment()])
    );
    api.getVendorReviews.mockResolvedValue(aVendorReviewsResponse([aVendorReview()]));

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(0);
    for (const href of all) {
      expect(href).not.toBe("#");
      expect(href).not.toBe("");
      expect(href).not.toContain("undefined");
      expect(href).not.toContain("null");
    }
  });

  it("the vendor's own website is an external link, opened safely", async () => {
    api.getVendor.mockResolvedValue(aVendor({ website: "acme.example" }));

    const { container } = await renderPage(VendorDetailPage, props());

    const site = container.querySelector('a[href="https://acme.example"]');
    expect(site).not.toBeNull();
    expect(site).toHaveAttribute("rel", "noopener noreferrer");
    expect(site).toHaveAttribute("target", "_blank");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Vendor assurance: the evidence card
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — vendor assurance evidence", () => {
  it("no finalized document: an upload prompt and the review queue — never a fabricated report", async () => {
    api.listVendorAssuranceDocuments.mockResolvedValue({ documents: [] });

    const { container } = await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText(
        "No assurance documents reviewed yet. Upload a SOC report to begin extraction and review."
      )
    ).toBeInTheDocument();
    expect(hrefOf(container, /View review queue/)).toBe("/vendor-assurance/queue");
    // No extraction is read when there is no document to read it for.
    expect(api.getVendorAssuranceExtraction).not.toHaveBeenCalled();
    // And no link into a report that does not exist.
    expect(hrefs(container).some((h) => /^\/vendor-assurance\/(?!queue)/.test(h))).toBe(false);
  });

  it("a finalized document renders the REVIEWED value and links to that document", async () => {
    api.listVendorAssuranceDocuments.mockResolvedValue({
      documents: [aVendorAssuranceDocument({ id: "doc-42" })],
    });
    api.getVendorAssuranceExtraction.mockResolvedValue(
      aVendorAssuranceExtractionResponse({
        current_decisions: {
          auditor_name: {
            decision: "edit",
            reviewed_value: "Ledger & Co LLP",
            reviewer_note: "Legal name",
            decided_by_user_id: "user-1",
            decided_at: "2026-05-21T00:00:00.000Z",
          },
          auditor_opinion: {
            decision: "reject",
            reviewed_value: null,
            reviewer_note: "Not stated in the report",
            decided_by_user_id: "user-1",
            decided_at: "2026-05-21T00:00:00.000Z",
          },
        },
      })
    );

    const { container } = await renderPage(VendorDetailPage, props());

    // A human's edit beats the model's extraction…
    expect(screen.getByText("Ledger & Co LLP")).toBeInTheDocument();
    expect(screen.queryByText("Ledger & Co")).toBeNull();
    // …and a rejected field is shown as rejected, never silently back-filled by the model.
    expect(screen.getByText("(rejected)")).toBeInTheDocument();
    expect(screen.queryByText("unqualified")).toBeNull();
    // Un-reviewed fields fall through to the extraction.
    expect(screen.getByText("SOC 2 Type II")).toBeInTheDocument();
    expect(hrefOf(container, /View finalized review/)).toBe("/vendor-assurance/doc-42");
  });

  it("a document whose extraction is missing falls back whole — no half-populated card", async () => {
    api.listVendorAssuranceDocuments.mockResolvedValue({
      documents: [aVendorAssuranceDocument({ id: "doc-42" })],
    });
    api.getVendorAssuranceExtraction.mockResolvedValue(null);

    const { container } = await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText(
        "No assurance documents reviewed yet. Upload a SOC report to begin extraction and review."
      )
    ).toBeInTheDocument();
    // No link into a review whose content the page could not read.
    expect(hrefOf(container, /View finalized review/)).toBeNull();
    expect(container.textContent).not.toContain("report_freshness_days");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Assessment + review history
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — history sections", () => {
  it("an assessment that produced a finding is marked as such — the linkage is visible", async () => {
    api.getVendorAssessmentsForVendor.mockResolvedValue(
      aVendorAssessmentsResponse([
        aVendorAssessment({ id: "va-1", summary: "Encryption unproven." }),
        aVendorAssessment({ id: "va-2", summary: "Contract reviewed, no issues." }),
      ])
    );
    api.getVendorFindings.mockResolvedValue({
      findings: [aVendorFinding({ id: "f-1", assessment_id: "va-1" })],
      total: 1,
    });

    await renderPage(VendorDetailPage, props());

    // Exactly ONE assessment carries the badge: the one a finding actually came from.
    expect(screen.getAllByText("· Finding created")).toHaveLength(1);
    expect(screen.getByText("Encryption unproven.")).toBeInTheDocument();
    expect(screen.getByText("Contract reviewed, no issues.")).toBeInTheDocument();
  });

  it("empty history reads as empty, and the counts agree with the lists", async () => {
    const { container } = await renderPage(VendorDetailPage, props());

    expect(screen.getByText("No assessments recorded")).toBeInTheDocument();
    expect(screen.getByText("No review cycles recorded")).toBeInTheDocument();
    expect(container.textContent).not.toContain("· Finding created");
  });

  it("a review cycle renders its status as a human label", async () => {
    api.getVendorReviews.mockResolvedValue(
      aVendorReviewsResponse([
        aVendorReview({ id: "vr-1", status: "concerns_identified", summary: "Two gaps." }),
      ])
    );

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText("Concerns Identified")).toBeInTheDocument();
    expect(screen.getByText("Two gaps.")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6b. Walkthrough remediation: empty-state CTA + risk-score explainability
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — review-cycle empty state offers an inline create path (V-3)", () => {
  it("an empty Review Cycles section links to this vendor's review workflow", async () => {
    api.getVendorReviews.mockResolvedValue(aVendorReviewsResponse([]));

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    // The empty state must not force the user to hunt for the sidebar action.
    expect(screen.getByText("No review cycles recorded")).toBeInTheDocument();
    expect(hrefOf(container, /Start a review cycle/)).toBe("/vendors/v-1/review");
  });

  it("a populated Review Cycles section does not show the inline create CTA", async () => {
    api.getVendorReviews.mockResolvedValue(
      aVendorReviewsResponse([aVendorReview({ id: "vr-1" })])
    );

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    expect(hrefOf(container, /Start a review cycle/)).toBeNull();
  });
});

describe("/vendors/[id] — risk-score explainability (V-4)", () => {
  it("attributes the score to the vendor's criticality and its open findings by severity", async () => {
    api.getVendor.mockResolvedValue(
      aVendor({ criticality: "high", current_risk_score: 42 })
    );
    api.getVendorFindings.mockResolvedValue({
      findings: [
        aVendorFinding({ id: "f-1", severity: "Critical", status: "open" }),
        aVendorFinding({ id: "f-2", severity: "High", status: "open" }),
        aVendorFinding({ id: "f-3", severity: "High", status: "in_progress" }),
      ],
      total: 3,
    });

    await renderPage(VendorDetailPage, props());

    expect(screen.getByText("How this score is derived")).toBeInTheDocument();
    expect(
      screen.getByText("Based on High criticality and 3 open findings (1 Critical, 2 High).")
    ).toBeInTheDocument();
  });

  it("a scored vendor with no criticality and no findings still reads honestly", async () => {
    api.getVendor.mockResolvedValue(
      aVendor({ criticality: null, current_risk_score: 80 })
    );
    api.getVendorFindings.mockResolvedValue({ findings: [], total: 0 });

    await renderPage(VendorDetailPage, props());

    expect(
      screen.getByText("Based on unspecified criticality and no open findings.")
    ).toBeInTheDocument();
  });

  it("an UNSCORED vendor shows no derivation — there is no score to attribute", async () => {
    api.getVendor.mockResolvedValue(aVendor({ current_risk_score: null }));

    const { container } = await renderPage(VendorDetailPage, props());

    expect(container.textContent).not.toContain("How this score is derived");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Authorization + entitlement
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — authorization and entitlement", () => {
  it("sends a signed-out visitor to /login and never touches the engine", async () => {
    signedOut();

    expect(await expectRedirect(VendorDetailPage, props())).toBe("/login");
    expect(api.getVendor).not.toHaveBeenCalled();
  });

  it("an unentitled (free) caller is redirected to /dashboard — the vendor is never fetched", async () => {
    signedIn({ entitlementLevel: "free" });

    expect(await expectRedirect(VendorDetailPage, props())).toBe("/dashboard");
    // The gate runs BEFORE the read: an unentitled caller's token never reaches the engine.
    expect(api.getVendor).not.toHaveBeenCalled();
  });

  it.each(["platform", "premium", "team"])(
    "an entitled caller (%s) is served the vendor",
    async (level) => {
      signedIn({ entitlementLevel: level });

      await renderPage(VendorDetailPage, props());

      expect(
        screen.getByRole("heading", { level: 1, name: "Acme Cloud" })
      ).toBeInTheDocument();
    }
  );

  it("an API-key caller with no entitlement on the session is gated to /dashboard", async () => {
    // apiKeyOnly() carries no entitlementLevel; the page defaults it to "free". This is
    // the REAL behavior — asserted so a change to the default is a deliberate one.
    apiKeyOnly();

    expect(await expectRedirect(VendorDetailPage, props())).toBe("/dashboard");
  });

  it("an API-key caller WITH platform entitlement is served, using the key as the token", async () => {
    signedIn({ jwtToken: undefined, apiKey: "test-key", entitlementLevel: "platform" });

    await renderPage(VendorDetailPage, props("v-1"));

    expect(api.getVendor).toHaveBeenCalledWith("test-key", "v-1");
    expect(screen.getByRole("heading", { level: 1, name: "Acme Cloud" })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Framework assessment progress (walkthrough V-follow-up)
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — framework assessment progress", () => {
  const summary = {
    total: 4,
    pass: 1,
    partial: 1,
    fail: 1,
    not_assessed: 1,
    progress_pct: 75,
    last_response_at: "2026-07-10T14:00:00.000Z",
  };

  it("shows per-framework progress with last-updated and a continue link", async () => {
    api.getFrameworks.mockResolvedValue({
      frameworks: [aFramework({ id: "fw-1", name: "NIST CSF", version: "2.0" })],
    });
    api.getFrameworkRequirements.mockResolvedValue({
      framework: { id: "fw-1", name: "NIST CSF", version: "2.0" },
      requirements: [],
      summary,
    });

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    expect(api.getFrameworkRequirements).toHaveBeenCalledWith(
      "test-jwt",
      "fw-1",
      "vendor",
      "v-1",
    );
    expect(screen.getByText("Framework Assessments")).toBeInTheDocument();
    // Progress is COMPLETION — labeled so it can't read as a verdict (O-5).
    expect(screen.getByText(/3 of 4 requirements assessed · 75% — completion, not readiness/)).toBeInTheDocument();
    expect(screen.getByText(/Last updated: Jul 10, 2026/)).toBeInTheDocument();
    expect(hrefOf(container, "Continue assessment")).toBe(
      "/vendors/v-1/assess/framework?frameworkId=fw-1",
    );
  });

  it("an untouched framework is not listed; the empty state routes to the assess flow", async () => {
    api.getFrameworks.mockResolvedValue({
      frameworks: [aFramework({ id: "fw-1", name: "NIST CSF", version: "2.0" })],
    });
    api.getFrameworkRequirements.mockResolvedValue({
      framework: { id: "fw-1", name: "NIST CSF", version: "2.0" },
      requirements: [],
      summary: { total: 4, pass: 0, partial: 0, fail: 0, not_assessed: 4, progress_pct: 0, last_response_at: null },
    });

    const { container } = await renderPage(VendorDetailPage, props("v-1"));

    expect(screen.getByText(/No framework assessments started for this vendor/)).toBeInTheDocument();
    expect(hrefOf(container, "Assess against a framework")).toBe("/vendors/v-1/assess/framework");
    expect(screen.queryByText(/Continue assessment/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty states carry a next step (walkthrough V-1 follow-up)
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — remaining empty states explain what to do", () => {
  it("Active Findings empty state explains where findings come from and offers the assess flow", async () => {
    const { container } = await renderPage(VendorDetailPage, props("v-1"));
    expect(screen.getByText(/findings appear here when an assessment or review cycle identifies an issue/)).toBeInTheDocument();
    expect(hrefOf(container, "Run an assessment")).toBe("/vendors/v-1/assess");
  });

  it("Dependent AI Systems empty state points at the AI inventory", async () => {
    const { container } = await renderPage(VendorDetailPage, props("v-1"));
    expect(screen.getByText(/Dependencies are declared on an AI system/)).toBeInTheDocument();
    expect(hrefOf(container, "review your AI inventory")).toBe("/ai-systems");
  });
});
