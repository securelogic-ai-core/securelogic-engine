/**
 * /ai-systems/[id] — the AI system detail render contract.
 *
 * Same shape of surface as /vendors/[id], and the same sharpest edge: the page is
 * addressed by a raw id from the URL bar, and the engine is the only authority on
 * whether the caller may see it. A null system must render NOTHING.
 *
 * The findings section used to be assembled from an ORG-WIDE read — `getFindings(token,
 * { limit: 50 })`, filtered down to this system in the browser. Past 50 org findings a
 * system's own findings fell off the end of the page before the filter ever saw them, and
 * this page printed "0 open findings" for a system that had them. A truncation is not a
 * zero. It now reads `getAiSystemFindings(token, id)` — resolved in the database — and the
 * tile prints the engine's COUNT, not the length of the rows beside it.
 *
 * The truncation itself is only provable against a real database holding more findings
 * than the old page could carry: see test/isolation/aiSystemFindings.test.ts. What is
 * provable HERE is the page's half of the contract — that it asks for the scoped read,
 * prints the count it was handed, and never turns a failed resolve into a zero.
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
  getAiSystemFindings: vi.fn(),
  getAiSystemSignals: vi.fn(),
  getAiSystemVendorDependencies: vi.fn(),
  // The T2 governance reads — defaulted empty here; their render contract lives
  // in aiSystemGovernance.render.test.tsx.
  getAiSystemGovernanceLinks: vi.fn(),
  getAiUseApprovals: vi.fn(),
  getTeamMembers: vi.fn(),
  getFrameworks: vi.fn(),
  getControls: vi.fn(),
  getPolicies: vi.fn(),
  getObligations: vi.fn(),
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

/**
 * The scoped-findings payload, shaped like the engine's.
 *
 * The counts default to being DERIVED from the rows — but they are separate fields on
 * purpose, and the tests below override them, because the whole point of the fix is that
 * the count is computed over the full matched set while `findings` is a bounded page.
 * A helper that could only ever produce `count === rows.length` would be unable to
 * express the bug it exists to prevent.
 */
const aiFindings = (
  findings: ReturnType<typeof aFinding>[],
  overrides: Partial<{ total: number; open_total: number; active_total: number }> = {}
) => ({
  findings,
  total: findings.length,
  open_total: findings.filter((f) => f.status === "open").length,
  active_total: findings.filter((f) => f.status === "open" || f.status === "in_progress").length,
  ...overrides,
});

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
  api.getAiSystemFindings.mockResolvedValue(aiFindings([]));
  api.getAiSystemSignals.mockResolvedValue([]);
  api.getAiSystemVendorDependencies.mockResolvedValue([]);
  api.getAiSystemGovernanceLinks.mockResolvedValue([]);
  api.getAiUseApprovals.mockResolvedValue({ count: 0, current_decision: null, approvals: [] });
  api.getTeamMembers.mockResolvedValue(null);
  api.getFrameworks.mockResolvedValue(null);
  api.getControls.mockResolvedValue(null);
  api.getPolicies.mockResolvedValue(null);
  api.getObligations.mockResolvedValue(null);
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
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([findingFromReview("f-1", "Someone else's finding")])
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

  it("asks the engine for THIS system's findings — it does not read the org's and sift them", async () => {
    // The entity boundary now lives in the database, where it can see every finding,
    // rather than in a browser-side filter that could only see the first 50 the org had.
    await renderPage(AiSystemDetailPage, props("ai-7"));

    expect(api.getAiSystemFindings).toHaveBeenCalledWith("test-jwt", "ai-7");
    // The org-wide read is gone. If it ever returns, it brings the truncation with it.
    expect((api as Record<string, unknown>).getFindings).toBeUndefined();
  });

  it("the tile prints the engine's COUNT, not the number of rows it happened to render", async () => {
    // THE REGRESSION, at the page layer. `findings` is a bounded display page; the counts
    // are computed over the whole matched set. A tile that counts its own rows silently
    // republishes the page cap as the truth — which is exactly how "0 open findings"
    // appeared for a system that had them.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings(
        [findingFromReview("f-1", "One row on this page")],
        // The engine saw 20 ACTIVE findings (12 of them strictly open); it handed
        // back one row to display. The tile must print the ACTIVE count.
        { total: 40, open_total: 12, active_total: 20 }
      )
    );

    await renderPage(AiSystemDetailPage, props());

    const heading = screen.getByText("Active Findings").parentElement as HTMLElement;
    expect(heading.textContent).toContain("20");
    // The Governance Summary headline reads the SAME number — both the section badge and
    // the 4xl sidebar figure counted their own rows before, so both said "1".
    expect(screen.getAllByText("20")).toHaveLength(2);
    expect(screen.queryByText("active finding")).toBeNull(); // not the singular of one row
    // ...and it is NOT the strictly-open population, which this tile used to print.
    expect(screen.queryByText("12")).toBeNull();
  });

  it("a FAILED findings resolve is not a zero — it says so", async () => {
    // The other way to print a confident zero: coalesce a null resolve to []. The page
    // used to do exactly that (`findingsData?.findings ?? []`), so an engine 500 rendered
    // "No open findings for this AI system." — indistinguishable from a clean system.
    api.getAiSystemFindings.mockResolvedValue(null);

    const { container } = await renderPage(AiSystemDetailPage, props());

    expect(screen.queryByText("No open findings for this AI system.")).toBeNull();
    expect(screen.getByText(/Could not load findings for this AI system/)).toBeInTheDocument();
    expect(screen.getByText(/This is not a zero/)).toBeInTheDocument();
    // And the count is withheld rather than invented.
    expect(container.textContent).toContain("—");
    expect(screen.getByText("findings unavailable")).toBeInTheDocument();
  });

  it("the token on every read is the CALLER's — the engine's org scope rides on it", async () => {
    signedIn({ jwtToken: "caller-token" });

    await renderPage(AiSystemDetailPage, props());

    for (const fn of [
      api.getAiSystem,
      api.getGovernanceReviewsForSystem,
      api.getAiGovernanceAssessments,
      api.getAiSystemFindings,
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
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([
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
    api.getAiSystemFindings.mockResolvedValue(aiFindings([]));

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("No active findings for this AI system.")).toBeInTheDocument();
    // The Governance Summary headline agrees with the list — and is singular/plural correct.
    expect(screen.getByText("active findings")).toBeInTheDocument();
  });

  it("in-progress work IS Active — it is counted here and it is shown", async () => {
    // This test used to assert the DEFECT: the page counted only `status === "open"`, so
    // a finding vanished from the AI system's risk picture the moment somebody started
    // remediating it, and this page disagreed with vendor detail about the same word.
    // Both now count the one enterprise population: operational_status <> 'closed'.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([aGovernanceReview({ id: "gr-1" })])
    );
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([
        findingFromReview("f-1", "Open work", { status: "open" }),
        findingFromReview("f-2", "Work already underway", { status: "in_progress" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Open work")).toBeInTheDocument();
    expect(screen.getByText("Work already underway")).toBeInTheDocument();
    expect(screen.getByText("active findings")).toBeInTheDocument(); // plural: both counted
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
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([findingFromReview("f-1", "No human-in-the-loop on denials")])
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
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([findingFromAssessment("f-1", "Model card missing evaluations")])
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
    api.getAiSystemFindings.mockResolvedValue(aiFindings([])); // no findings exist at all

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Pre-deployment review")).toBeInTheDocument();
    expect(screen.getByText("No active findings for this AI system.")).toBeInTheDocument();
    expect(screen.queryByText("Finding created")).not.toBeInTheDocument();
  });

  it("...and DOES claim it when the review really did raise one", async () => {
    // The other direction — a gate that never lights is as useless as one always lit.
    api.getGovernanceReviewsForSystem.mockResolvedValue(
      aGovernanceReviewsResponse([
        aGovernanceReview({ id: "gr-1", review_type: "Pre-deployment review" }),
      ])
    );
    api.getAiSystemFindings.mockResolvedValue(
      aiFindings([
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
