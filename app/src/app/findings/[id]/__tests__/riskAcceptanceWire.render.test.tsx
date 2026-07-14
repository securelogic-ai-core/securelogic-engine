/**
 * Risk acceptance — the WIRE between the page and the engine, unmocked.
 *
 * WHY THIS EXISTS, SEPARATELY FROM riskAcceptancePanel.render.test.tsx:
 *
 * That suite mocks `getRiskAcceptancesForFinding`, which is the right call for proving
 * panel BEHAVIOUR (SoD, narratives, verbs) — but it mocks away the one thing that was
 * actually broken. The client asked the engine for `?finding_id=<id>` and the engine's
 * list route silently ignored the parameter, answering with the ORG'S ENTIRE REGISTER.
 * The panel then rendered another finding's signed acceptance as this finding's own, and
 * approve/reject/withdraw acted on that wrong record. Every existing test passed.
 *
 * So this suite drives the page through the REAL app API boundary (`@/lib/api` is NOT
 * mocked here) and stubs only the network, `fetch`. It asserts the contract the engine
 * now enforces in SQL:
 *
 *   1. the request is actually scoped — the URL carries finding_id=<this finding>;
 *   2. the page renders the record the ENGINE returned for this finding;
 *   3. a finding with no acceptance shows the propose affordance, not someone else's
 *      binding acceptance — i.e. [] is honoured as "none for THIS finding";
 *   4. flag OFF keeps the legacy control and makes no risk-acceptance call at all.
 *
 * The server-side proof that the filter narrows rows lives in
 * test/isolation/riskAcceptanceLifecycle.test.ts (real Postgres, incl. cross-org).
 * Together they close the loop the mock left open.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aFinding, anActionsResponse, aFindingContext, aRiskAcceptance } from "@/test/fixtures";

// NOTE: @/lib/api is deliberately NOT mocked — that is the entire point of this file.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const actions = vi.hoisted(() => ({
  proposeRiskAcceptanceAction: vi.fn(async () => ({})),
  approveRiskAcceptanceAction: vi.fn(async () => ({})),
  rejectRiskAcceptanceAction: vi.fn(async () => ({})),
  withdrawRiskAcceptanceAction: vi.fn(async () => ({})),
  attachRiskAcceptanceEvidenceAction: vi.fn(async () => ({})),
}));
vi.mock("../riskAcceptanceActions", () => actions);

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * One fetch stub standing in for the whole engine, routed by URL — so the page's real
 * client functions each get a plausible answer and the risk-acceptance call is the only
 * thing under test. `acceptances` is what the engine answers for /api/risk-acceptances;
 * `null` means the route 404s (engine flag off).
 */
function engine(acceptances: unknown[] | null) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/risk-acceptances")) {
      return acceptances === null
        ? json(404, { error: "not_found" })
        : json(200, { acceptances, total: acceptances.length });
    }
    // Envelopes matter here: the real client unwraps body.context / body.finding. Getting
    // these wrong is how the page silently falls back to the legacy detail.
    if (u.includes("/context")) return json(200, { context: aFindingContext() });
    if (u.includes("/actions")) return json(200, anActionsResponse([]));
    if (u.includes("/evidence")) return json(200, { evidence: [] });
    if (u.includes("/team")) return json(200, { members: [] });
    if (u.includes("/findings/")) return json(200, { finding: aFinding() });
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The risk-acceptance request the page made, if any. */
const raCall = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/api/risk-acceptances"));

beforeEach(() => {
  vi.clearAllMocks();
  signedIn({ userId: "user-2" }); // the viewer; NOT the proposer in the fixtures
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Risk acceptance — the page asks the engine for THIS finding's acceptances", () => {
  it("scopes the request with finding_id (the filter the engine enforces in SQL)", async () => {
    const fetchMock = engine([aRiskAcceptance({ finding_id: "f-1", state: "approved" })]);

    await renderPage(FindingDetailPage, props("f-1"));

    const url = raCall(fetchMock);
    expect(url).toBeTruthy();
    // The bug was a filter the server ignored. Pin the parameter the server now honours.
    expect(url).toContain("finding_id=f-1");
  });

  it("renders the record the engine returned for this finding", async () => {
    engine([
      aRiskAcceptance({
        finding_id: "f-1",
        state: "approved",
        rationale: "Compensating control in place until Q4 migration.",
      }),
    ]);

    await renderPage(FindingDetailPage, props("f-1"));

    // The panel owns accepted_risk when active: the legacy one-click control is gone.
    expect(await screen.findByText(/Compensating control in place until Q4 migration\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Accept Risk$/i })).not.toBeInTheDocument();
  });

  it("a finding with NO acceptance offers to propose one — it does not inherit another finding's", async () => {
    // Pre-fix, the engine answered with the org's whole register here and the panel
    // rendered a stranger's binding acceptance on this finding. [] is now the truth,
    // and it has to read as "none yet", not as "feature off".
    const fetchMock = engine([]);

    await renderPage(FindingDetailPage, props("f-2"));

    expect(raCall(fetchMock)).toContain("finding_id=f-2");
    expect(await screen.findByText(/Propose risk acceptance/i)).toBeInTheDocument();
    // Nothing may claim this finding is accepted, binding, or governed.
    expect(screen.queryByText(/binding/i)).not.toBeInTheDocument();
  });

  it("flag OFF keeps the legacy control and never calls the risk-acceptance route", async () => {
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "");
    const fetchMock = engine([aRiskAcceptance({ finding_id: "f-1", state: "approved" })]);

    await renderPage(FindingDetailPage, props("f-1"));

    // Two-switch: with the app switch off the page must not even reach for the route,
    // and the legacy Accept-Risk affordance stays exactly as it was.
    expect(raCall(fetchMock)).toBeUndefined();
    expect(await screen.findByRole("button", { name: /^Accept Risk$/i })).toBeInTheDocument();
  });
});
