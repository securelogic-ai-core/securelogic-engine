/**
 * /ai-systems/[id] — the AI system detail render contract.
 *
 * Same shape of surface as /vendors/[id], and the same sharpest edge: the page is
 * addressed by a raw id from the URL bar, and the engine is the only authority on
 * whether the caller may see it. A null system must render NOTHING.
 *
 * This page is also the one place in the product that assembles a detail view from an
 * ORG-WIDE read: it fetches `getFindings(token, { limit: 50 })` and filters client-side
 * to the findings whose source_id belongs to THIS system's reviews/assessments. That
 * filter is the tenant/entity boundary for this section, so it is tested directly —
 * another system's finding must never appear here.
 *
 * The page reads no feature flag — there is no flag branch to cover.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  sessionStore,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import {
  aFinding,
  aFindingsResponse,
  aGovernanceReview,
  aGovernanceReviewsResponse,
  anAiGovernanceAssessment,
  anAiGovernanceAssessmentsResponse,
  anAiSystem,
  anAiSystemLinkedSignal,
  anAiVendorDependency,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getAiSystem: vi.fn(),
  getGovernanceReviewsForSystem: vi.fn(),
  getAiGovernanceAssessments: vi.fn(),
  getFindings: vi.fn(),
  getAiSystemSignals: vi.fn(),
  getAiSystemVendorDependencies: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

// FindingCard and AssessmentStatusCard import server actions, which import next/cache —
// no request scope in a test process. They are rendered as handlers, never invoked.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import AiSystemDetailPage from "../page";

const props = (id = "ai-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

/** A finding sourced from one of THIS system's governance reviews. */
const findingFromReview = (id: string, title: string, overrides = {}) =>
  aFinding({
    id,
    title,
    source_type: "ai_review",
    source_id: "gr-1",
    status: "open",
    ...overrides,
  });

/** A finding sourced from one of THIS system's governance assessments. */
const findingFromAssessment = (id: string, title: string, overrides = {}) =>
  aFinding({
    id,
    title,
    source_type: "ai_governance_review",
    source_id: "aga-1",
    status: "open",
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAiSystem.mockResolvedValue(anAiSystem());
  api.getGovernanceReviewsForSystem.mockResolvedValue(aGovernanceReviewsResponse([]));
  api.getAiGovernanceAssessments.mockResolvedValue(anAiGovernanceAssessmentsResponse([]));
  api.getFindings.mockResolvedValue(aFindingsResponse([]));
  api.getAiSystemSignals.mockResolvedValue([]);
  api.getAiSystemVendorDependencies.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────
// 1. The record the engine returned for THIS id — and nothing else
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — the correct, tenant-scoped record", () => {
  it("asks the engine for the id in the URL and renders that system", async () => {
    api.getAiSystem.mockResolvedValue(anAiSystem({ id: "ai-9", name: "Underwriting Scorer" }));

    await renderPage(AiSystemDetailPage, props("ai-9"));

    expect(api.getAiSystem).toHaveBeenCalledWith("test-jwt", "ai-9");
    expect(
      screen.getByRole("heading", { level: 1, name: "Underwriting Scorer" })
    ).toBeInTheDocument();
  });

  it("a system the caller may NOT see renders NOTHING — no shell, no empty-but-plausible page", async () => {
    // Another org's system (or a deleted one) comes back null from the engine. The other
    // reads still resolve to empty lists, so a page that rendered around the null would
    // show a complete, zeroed-out AI system detail for a record the caller has no right
    // to know exists. The honest outcome is the inventory list.
    api.getAiSystem.mockResolvedValue(null);
    api.getFindings.mockResolvedValue(
      aFindingsResponse([findingFromReview("f-1", "Someone else's finding")])
    );
    api.getAiSystemVendorDependencies.mockResolvedValue([anAiVendorDependency()]);

    expect(await expectRedirect(AiSystemDetailPage, props("ai-other-org"))).toBe("/ai-systems");
  });

  it("renders ONLY the fetched system's own attributes", async () => {
    api.getAiSystem.mockResolvedValue(
      anAiSystem({
        name: "Claims Triage Copilot",
        use_case: "Ranks inbound claims for adjuster review.",
        criticality: "critical",
        deployment_status: "production",
        model_type: "LLM",
        data_classification: "PHI",
        risk_classification: "high_risk",
      })
    );

    await renderPage(AiSystemDetailPage, props());

    expect(
      screen.getByRole("heading", { level: 1, name: "Claims Triage Copilot" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ranks inbound claims for adjuster review.").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("LLM")).toBeInTheDocument();
    expect(screen.getByText("PHI")).toBeInTheDocument();
    expect(screen.getByText("high_risk")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Related reads are scoped to THIS system — and the org-wide read is
//    filtered to it
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — no cross-entity fill", () => {
  it("reviews, assessments, signals and vendor dependencies are all fetched for this system", async () => {
    await renderPage(AiSystemDetailPage, props("ai-1"));

    expect(api.getGovernanceReviewsForSystem).toHaveBeenCalledWith("test-jwt", "ai-1", 20);
    expect(api.getAiGovernanceAssessments).toHaveBeenCalledWith("test-jwt", "ai-1", 20);
    expect(api.getAiSystemSignals).toHaveBeenCalledWith("test-jwt", "ai-1", 10);
    expect(api.getAiSystemVendorDependencies).toHaveBeenCalledWith("test-jwt", "ai-1");
  });

  it("another system's findings are NEVER shown here, even though the read is org-wide", async () => {
    // The findings read is org-wide (`getFindings(token, {limit:50})`); the entity
    // boundary is enforced by the page's own filter. This is the test that holds it.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getAiGovernanceAssessments.mockResolvedValue(
      anAiGovernanceAssessmentsResponse([anAiGovernanceAssessment({ id: "aga-1" })])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        findingFromReview("f-1", "Mine: no human-in-the-loop on denials"),
        findingFromAssessment("f-2", "Mine: model card missing evaluations"),
        // Another AI system's review, another system's assessment, and a finding with
        // no source at all. None of these belong on this page.
        aFinding({ id: "f-3", title: "Theirs: review of a different system", source_type: "ai_review", source_id: "gr-OTHER" }),
        aFinding({ id: "f-4", title: "Theirs: assessment of a different system", source_type: "ai_governance_review", source_id: "aga-OTHER" }),
        aFinding({ id: "f-5", title: "Unrelated: a manual cyber finding", source_type: "manual", source_id: null }),
        aFinding({ id: "f-6", title: "Unrelated: a vendor finding", source_type: "vendor_assessment", source_id: "va-1" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Mine: no human-in-the-loop on denials")).toBeInTheDocument();
    expect(screen.getByText("Mine: model card missing evaluations")).toBeInTheDocument();
    for (const foreign of [
      "Theirs: review of a different system",
      "Theirs: assessment of a different system",
      "Unrelated: a manual cyber finding",
      "Unrelated: a vendor finding",
    ]) {
      expect(screen.queryByText(foreign)).toBeNull();
    }

    // The count beside the section is the filtered population, not the org's total.
    const heading = screen.getByText("Open Findings").parentElement as HTMLElement;
    expect(heading.textContent).toContain("2");
  });

  it("a source_id that matches NO review or assessment of this system is dropped", async () => {
    // This system has no reviews/assessments at all: nothing can legitimately be
    // attributed to it, so an org finding carrying a stale ai_review source must not
    // slip through on source_type alone.
    api.getFindings.mockResolvedValue(
      aFindingsResponse([findingFromReview("f-1", "Orphaned AI finding")])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.queryByText("Orphaned AI finding")).toBeNull();
    expect(screen.getByText("No open findings for this AI system.")).toBeInTheDocument();
  });

  it("the token on every read is the CALLER's — the engine's org scope rides on it", async () => {
    signedIn({ jwtToken: "caller-token" });

    await renderPage(AiSystemDetailPage, props());

    for (const fn of [
      api.getAiSystem,
      api.getGovernanceReviewsForSystem,
      api.getAiGovernanceAssessments,
      api.getFindings,
      api.getAiSystemSignals,
      api.getAiSystemVendorDependencies,
    ]) {
      expect(fn.mock.calls[0][0]).toBe("caller-token");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Canonical linkage: findings, intelligence, vendor dependencies
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — related findings", () => {
  it("renders this system's open findings with their real labels", async () => {
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        findingFromReview("f-1", "No human-in-the-loop on denials", {
          severity: "Critical",
          description: "Automated denials ship without adjuster review.",
        }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("No human-in-the-loop on denials")).toBeInTheDocument();
    expect(screen.getByText("Automated denials ship without adjuster review.")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("a system with no findings renders an honest empty state and a zero that is real", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse([]));

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("No open findings for this AI system.")).toBeInTheDocument();
    // The Governance Summary headline agrees with the list — and is singular/plural correct.
    expect(screen.getByText("open findings")).toBeInTheDocument();
  });

  it("only OPEN findings are counted — in-progress work is not shown here (documented)", async () => {
    // The vendor detail page counts open + in_progress as "open findings"; this page counts
    // only `status === "open"`. The two surfaces therefore disagree about the same word.
    // Asserted so the divergence is visible; see the report accompanying this suite.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        findingFromReview("f-1", "Open work", { status: "open" }),
        findingFromReview("f-2", "Work already underway", { status: "in_progress" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Open work")).toBeInTheDocument();
    expect(screen.queryByText("Work already underway")).toBeNull();
    expect(screen.getByText("open finding")).toBeInTheDocument(); // singular: exactly 1
  });
});

describe("/ai-systems/[id] — external intelligence", () => {
  it("a linked signal renders its severity, CVE and summary, and deep-links to the event", async () => {
    api.getAiSystemSignals.mockResolvedValue([
      anAiSystemLinkedSignal({
        link_id: "link-1",
        severity: "critical",
        affected_cve: "CVE-2026-1234",
        source: "cisa_kev",
        event_summary: "Actively exploited RCE in the hosted inference runtime",
        intelligence_event_id: "evt-77",
      }),
    ]);

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(
      screen.getByText("Actively exploited RCE in the hosted inference runtime")
    ).toBeInTheDocument();
    expect(screen.getByText("CVE-2026-1234")).toBeInTheDocument();
    expect(screen.getByText("via cisa_kev")).toBeInTheDocument();
    expect(hrefOf(container, /View intelligence event/)).toBe("/intelligence/evt-77");
  });

  it("a signal with no canonical event offers NO link rather than a link to nothing", async () => {
    api.getAiSystemSignals.mockResolvedValue([
      anAiSystemLinkedSignal({
        intelligence_event_id: null,
        event_summary: null,
        normalized_summary: "Prompt-injection bypass in the hosted runtime",
      }),
    ]);

    const { container } = await renderPage(AiSystemDetailPage, props());

    // The row still carries its meaning…
    expect(
      screen.getByText("Prompt-injection bypass in the hosted runtime")
    ).toBeInTheDocument();
    // …but there is no drill-through to an event that does not exist.
    expect(hrefOf(container, /View intelligence event/)).toBeNull();
    expect(hrefs(container).some((h) => h.startsWith("/intelligence/"))).toBe(false);
  });

  it("no linked signals: the empty state routes to where matches are confirmed", async () => {
    api.getAiSystemSignals.mockResolvedValue([]);

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText(/No external signals are linked to this system/)).toBeInTheDocument();
    // A dead end here would strand the operator; the queue is where a match becomes a link.
    expect(hrefOf(container, "review queue")).toBe("/queue");
  });
});

describe("/ai-systems/[id] — vendor dependencies (the supply chain)", () => {
  it("each dependency deep-links to the vendor that actually exists, with a human role", async () => {
    api.getAiSystemVendorDependencies.mockResolvedValue([
      anAiVendorDependency({
        dependency_id: "dep-1",
        vendor_id: "v-77",
        vendor_name: "Acme Cloud",
        dependency_role: "model_provider",
        vendor_criticality: "high",
      }),
    ]);

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Vendor Dependencies (1)")).toBeInTheDocument();
    expect(hrefOf(container, "Acme Cloud")).toBe("/vendors/v-77");
    expect(screen.getByText("Model provider")).toBeInTheDocument();
  });

  it("no dependencies: an honest empty state that explains what the edge would buy", async () => {
    api.getAiSystemVendorDependencies.mockResolvedValue([]);

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Vendor Dependencies (0)")).toBeInTheDocument();
    expect(
      screen.getByText(/No vendor dependencies recorded/)
    ).toBeInTheDocument();
    expect(hrefs(container).some((h) => h.startsWith("/vendors/"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Every link is a real destination
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — links land somewhere real", () => {
  it("the action rail routes to this system's own workflows", async () => {
    const { container } = await renderPage(AiSystemDetailPage, props("ai-1"));

    expect(hrefOf(container, "New Governance Review")).toBe("/ai-systems/ai-1/review");
    expect(hrefOf(container, "New Assessment")).toBe("/ai-systems/ai-1/assess");
    expect(hrefOf(container, "Add Evidence")).toBe("/ai-systems/ai-1/evidence/new");
    expect(hrefOf(container, "Edit AI System")).toBe("/ai-systems/ai-1/edit");
    expect(hrefOf(container, "AI Systems")).toBe("/ai-systems");
  });

  it("no dead links anywhere on the page: no '#', no empty href, no undefined id", async () => {
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getAiGovernanceAssessments.mockResolvedValue(
      anAiGovernanceAssessmentsResponse([anAiGovernanceAssessment({ id: "aga-1" })])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([findingFromReview("f-1", "No human-in-the-loop on denials")])
    );
    api.getAiSystemSignals.mockResolvedValue([anAiSystemLinkedSignal()]);
    api.getAiSystemVendorDependencies.mockResolvedValue([anAiVendorDependency()]);

    const { container } = await renderPage(AiSystemDetailPage, props("ai-1"));

    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(0);
    for (const href of all) {
      expect(href).not.toBe("#");
      expect(href).not.toBe("");
      expect(href).not.toContain("undefined");
      expect(href).not.toContain("null");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Governance reviews and assessments
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — governance history", () => {
  it("an assessment that produced a finding is marked — and one that did not is NOT", async () => {
    api.getAiGovernanceAssessments.mockResolvedValue(
      anAiGovernanceAssessmentsResponse([
        anAiGovernanceAssessment({ id: "aga-1", summary: "Model card missing evaluations." }),
        anAiGovernanceAssessment({ id: "aga-2", summary: "Bias testing complete, no gaps." }),
      ])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([findingFromAssessment("f-1", "Model card missing evaluations")])
    );

    await renderPage(AiSystemDetailPage, props());

    // Exactly ONE assessment carries the badge: the one a finding actually came from.
    expect(screen.getAllByText("· Finding created")).toHaveLength(1);
    expect(screen.getByText("Model card missing evaluations.")).toBeInTheDocument();
    expect(screen.getByText("Bias testing complete, no gaps.")).toBeInTheDocument();
  });

  it("a governance review claims 'Finding created' ONLY when a finding actually exists", async () => {
    // The chip used to render on EVERY review, checked against nothing — so a review that
    // produced no finding told an auditor one had been raised. A fabricated linkage claim
    // on a governance surface. Now gated on a real `ai_review` finding pointing at the
    // review, exactly as the assessments section already gated the identical chip.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([
        aGovernanceReview({ id: "gr-1", review_type: "Pre-deployment review" }),
      ])
    );
    api.getFindings.mockResolvedValue(aFindingsResponse([])); // no findings exist at all

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Pre-deployment review")).toBeInTheDocument();
    expect(screen.getByText("No open findings for this AI system.")).toBeInTheDocument();
    expect(screen.queryByText("Finding created")).not.toBeInTheDocument();
  });

  it("...and DOES claim it when the review really did raise one", async () => {
    // The other direction — a gate that never lights is as useless as one always lit.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([
        aGovernanceReview({ id: "gr-1", review_type: "Pre-deployment review" }),
      ])
    );
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        aFinding({ id: "f-1", source_type: "ai_review", source_id: "gr-1", status: "open" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Finding created")).toBeInTheDocument();
  });

  it("the latest assessment's status drives the sidebar summary and its status control", async () => {
    api.getAiGovernanceAssessments.mockResolvedValue(
      anAiGovernanceAssessmentsResponse([
        anAiGovernanceAssessment({ id: "aga-1", status: "non_compliant" }),
        anAiGovernanceAssessment({ id: "aga-2", status: "compliant" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    // The FIRST assessment is the latest (engine returns newest-first).
    expect(screen.getAllByText("Non-Compliant").length).toBeGreaterThan(0);
    expect(screen.getByText("Latest status")).toBeInTheDocument();
  });

  it("no assessments: the summary says so instead of implying compliance", async () => {
    api.getAiGovernanceAssessments.mockResolvedValue(anAiGovernanceAssessmentsResponse([]));

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("No governance assessments yet.")).toBeInTheDocument();
    expect(screen.getByText("No assessments")).toBeInTheDocument();
    // Never a green "Compliant" for a system nobody has assessed.
    expect(container.textContent).not.toContain("Compliant");
  });

  it("no governance reviews: an honest empty state", async () => {
    api.getGovernanceReviewsForSystem.mockResolvedValue(aGovernanceReviewsResponse([]));

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("No governance reviews recorded.")).toBeInTheDocument();
    expect(screen.queryByText("Finding created")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Authorization + entitlement
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — authorization and entitlement", () => {
  it("sends a signed-out visitor to /login and never touches the engine", async () => {
    signedOut();

    expect(await expectRedirect(AiSystemDetailPage, props())).toBe("/login");
    expect(api.getAiSystem).not.toHaveBeenCalled();
  });

  it("an entitled (platform) caller is served the system", async () => {
    signedIn({ entitlementLevel: "platform" });

    await renderPage(AiSystemDetailPage, props());

    expect(
      screen.getByRole("heading", { level: 1, name: "Claims Triage Copilot" })
    ).toBeInTheDocument();
  });

  it("an entitled API-key caller is served, using the key as the token", async () => {
    apiKeyOnly();
    Object.assign(sessionStore.current, { entitlementLevel: "platform" });

    await renderPage(AiSystemDetailPage, props("ai-1"));

    expect(api.getAiSystem).toHaveBeenCalledWith("test-key", "ai-1");
    expect(
      screen.getByRole("heading", { level: 1, name: "Claims Triage Copilot" })
    ).toBeInTheDocument();
  });

  it("a FREE caller is sent to /dashboard — the same gate its sibling /vendors/[id] enforces", async () => {
    // This page used to gate on the TOKEN ONLY, so a free-tier session rendered the full
    // AI-system detail. Not a cross-org leak (the engine still scopes by org), but the two
    // sibling platform surfaces disagreed about who may open them, and only one was right.
    signedIn({ entitlementLevel: "free" });

    expect(await expectRedirect(AiSystemDetailPage, props())).toBe("/dashboard");
  });

  it("does not even ASK the engine for a system the caller is not entitled to see", async () => {
    // The gate must precede the fetch — redirecting after the read still spends an
    // engine call on a caller who may not have the answer.
    signedIn({ entitlementLevel: "free" });

    await expectRedirect(AiSystemDetailPage, props());

    expect(api.getAiSystem).not.toHaveBeenCalled();
  });
});
