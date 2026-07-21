/**
 * /approvals — the risk-acceptance approver queue, through the REAL app API boundary.
 *
 * `@/lib/api` is deliberately NOT mocked. Only `fetch` is stubbed, so these tests exercise
 * the actual wire contract: the URL the page requests (`?state=proposed`), how it unwraps
 * the engine's envelope, and how it distinguishes the three failure modes that a governance
 * queue must never conflate:
 *
 *     404 (flag off) → the section does not render AT ALL
 *     error          → say so; do NOT render "0 awaiting decision"
 *     ok + []        → an honest empty state
 *
 * Collapsing those is how a dark or broken queue comes to read as "all clear" — which is the
 * failure mode that matters here, because the thing being missed is a pending decision to
 * accept risk. Mocking the client away is exactly what let the previous bug through review.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const actions = vi.hoisted(() => ({
  approveRiskAcceptanceAction: vi.fn(async () => ({})),
  rejectRiskAcceptanceAction: vi.fn(async () => ({})),
  withdrawRiskAcceptanceAction: vi.fn(async () => ({})),
  proposeRiskAcceptanceAction: vi.fn(async () => ({})),
  attachRiskAcceptanceEvidenceAction: vi.fn(async () => ({})),
}));
vi.mock("@/app/findings/[id]/riskAcceptanceActions", () => actions);

import ApprovalsPage from "../page";

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A pending proposal as the ENGINE returns it — named people, not uuids. */
function aProposal(over: Record<string, unknown> = {}) {
  return {
    id: "ra-1",
    organization_id: "org-1",
    finding_id: "f-1",
    state: "proposed",
    owner_user_id: "user-9",
    rationale: "Compensating control in place until the Q4 migration.",
    requested_by_user_id: "user-1",
    approver_user_id: null,
    approved_at: null,
    decision_rationale: null,
    expires_at: "2026-12-01",
    withdrawn_at: null,
    withdrawal_reason: null,
    governance_review_required: false,
    promoted_risk_id: null,
    created_at: "2026-07-10T09:00:00.000Z",
    updated_at: "2026-07-10T09:00:00.000Z",
    finding_title: "Unpatched SharePoint RCE",
    finding_severity: "Critical",
    finding_priority: "immediate",
    finding_domain: "Cyber",
    finding_operational_status: "open",
    requested_by_name: "Pat Proposer",
    requested_by_email: "pat@ex.com",
    owner_name: "Olive Owner",
    owner_email: "olive@ex.com",
    approver_name: null,
    approver_email: null,
    is_self_proposed: false,
    evidence_count: 2,
    ...over,
  };
}

/**
 * One fetch stub for the whole engine, routed by URL. `acceptances` drives
 * /api/risk-acceptances: an array = 200, a number = that HTTP status.
 */
function engine(acceptances: unknown[] | number, opts: { awaiting?: number } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/risk-acceptances/summary")) {
      return typeof acceptances === "number"
        ? json(acceptances, { error: "nope" })
        : json(200, { summary: { awaiting_approval: opts.awaiting ?? acceptances.length, active_acceptances: 0, review_due_30d: 0, lapsed_pending_sweep: 0, expired: 0, governance_review_required: 0 } });
    }
    if (u.includes("/api/risk-acceptances")) {
      return typeof acceptances === "number"
        ? json(acceptances, { error: "nope" })
        : json(200, { acceptances, total: opts.awaiting ?? acceptances.length, limit: 50, offset: 0 });
    }
    // Entitlement must be a platform tier or the page redirects to /dashboard.
    if (u.includes("/api/me")) return json(200, { entitlementLevel: "platform" });
    if (u.includes("/api/auth/me")) return json(200, { role: "admin", id: "user-2" });
    if (u.includes("/api/approvals")) return json(200, { approvals: [] });
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const raUrl = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls
    .map((c) => String(c[0]))
    .find((u) => u.includes("/api/risk-acceptances") && !u.includes("/summary"));

beforeEach(() => {
  vi.clearAllMocks();
  // The APPROVER: a different user from the proposer in the fixture (user-1).
  signedIn({ userId: "user-2", jwtToken: "jwt-approver" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/approvals — a pending risk acceptance is discoverable without a hand-passed URL", () => {
  it("asks the engine for the PENDING queue, server-side", async () => {
    const fetchMock = engine([aProposal()]);
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    // ?state=proposed IS the pending queue — withdrawn/rejected/expired hold other states.
    const url = raUrl(fetchMock);
    expect(url).toBeTruthy();
    expect(url).toContain("state=proposed");
    // Paged server-side, not sliced in the browser.
    expect(url).toContain("limit=");
    expect(url).toContain("offset=");
  });

  it("shows the approver everything they must review — as people, not internal ids", async () => {
    engine([aProposal()]);
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(await screen.findByText("Unpatched SharePoint RCE")).toBeInTheDocument();
    expect(screen.getByText(/Compensating control in place until the Q4 migration\./)).toBeInTheDocument();
    expect(screen.getByText("Pat Proposer")).toBeInTheDocument();   // proposer
    expect(screen.getByText("Olive Owner")).toBeInTheDocument();    // accountable owner
    expect(screen.getByText("Critical")).toBeInTheDocument();       // severity
    expect(screen.getByText("Immediate")).toBeInTheDocument();      // priority, in customer words
    expect(screen.getByText("2 attached")).toBeInTheDocument();     // supporting evidence
    expect(screen.getByText(/Dec 1, 2026/)).toBeInTheDocument();    // review/expiration date
    expect(screen.getByText(/Jul 10, 2026/)).toBeInTheDocument();   // submitted

    // The next action is obvious, on the row.
    expect(screen.getByRole("button", { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reject$/ })).toBeInTheDocument();

    // No internal vocabulary or raw ids leak into the customer surface.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("ra-1");
    expect(body).not.toContain("user-1");
    expect(body).not.toContain("accepted_risk");
    expect(body).not.toContain("near_term");
  });

  it("the honest pending count comes from the summary, not the page length", async () => {
    // 1 row on this page, but 7 awaiting decision org-wide. Showing "1" would under-report
    // the governance backlog.
    engine([aProposal()], { awaiting: 7 });
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    // Exact strings: the header and the truncation note are two different sentences, and a
    // loose regex matches both.
    expect(await screen.findByText("7 awaiting decision")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 7 awaiting decision.")).toBeInTheDocument();
  });
});

describe("/approvals — separation of duties", () => {
  it("the proposer cannot approve their own proposal, and is told why", async () => {
    // Same user as the proposal's requested_by_user_id.
    signedIn({ userId: "user-1", jwtToken: "jwt-proposer" });
    engine([aProposal({ is_self_proposed: true })]);

    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(await screen.findByText("Unpatched SharePoint RCE")).toBeInTheDocument();
    // Refused in the UI BEFORE the round-trip — and the reason is stated, not implied.
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reject$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/You proposed this acceptance, so someone else has to decide it/i)).toBeInTheDocument();
  });
});

describe("/approvals — the three states a queue must never conflate", () => {
  it("flag OFF (404): the section does not render at all", async () => {
    engine(404);
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    // Not an empty state — an empty state asserts "nothing is pending", which cannot be
    // known while the route is dark.
    expect(screen.queryByRole("heading", { name: /Risk acceptances/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting decision/i)).not.toBeInTheDocument();
    // ...and the OTHER approval family is unaffected: one dark flag must not blank the page.
    expect(await screen.findByRole("heading", { name: /Treatment plans/i })).toBeInTheDocument();
  });

  it("error (500): says so — it does NOT report zero pending", async () => {
    engine(500);
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(await screen.findByText(/Could not load risk acceptances/i)).toBeInTheDocument();
    // The dangerous lie: "0 awaiting decision" when we simply could not look.
    expect(screen.queryByText(/0 awaiting decision/)).not.toBeInTheDocument();
  });

  it("empty (200, []): an honest 'nothing pending'", async () => {
    engine([]);
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(await screen.findByText(/No risk acceptances are awaiting your decision\./i)).toBeInTheDocument();
    expect(screen.getByText(/0 awaiting decision/)).toBeInTheDocument();
  });
});
