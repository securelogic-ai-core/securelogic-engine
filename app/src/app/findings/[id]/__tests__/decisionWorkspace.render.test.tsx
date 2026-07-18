/**
 * /findings/[id] — the Decision Workspace render contract.
 *
 * The helper suites next to this file (businessImpact.test.ts, decisionTransitions.test.ts)
 * prove the PURE FUNCTIONS are honest. Nothing proved the PAGE shows what they compute.
 * That gap is exactly where #637 ("a resolver failure is not a zero") lived: the derivation
 * was correct and the screen still told an operator the blast radius was clear.
 *
 * So these tests assert what a customer SEES:
 *   1. the four honest-emptiness states stay visually distinct and never collapse into a
 *      fake zero or a floored "Low";
 *   2. operational_status is DISPLAYED but never OFFERED as a control (system-derived axis),
 *      and the decision dropdown offers only legal moves (a dead control is the defect);
 *   3. the remediation state reflects the linked actions, and the empty state is a plan;
 *   4. authorization;
 *   5. the flag branches — legacy vs workspace, with no mixed state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, sp, setClientSearchParams } from "@/test/harness";
import { aFinding, anAction, anActionsResponse, aFindingContext } from "@/test/fixtures";
import { DECISION_STATES } from "../decisionTransitions";

const api = vi.hoisted(() => ({
  getFinding: vi.fn(),
  getActionsForFinding: vi.fn(),
  getFindingContext: vi.fn(),
  getTeamMembers: vi.fn(),
  getFindingEvidence: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

// The page's server actions import next/cache, which has no request scope in a test
// process. They are never invoked here — only rendered as handlers.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

/** Turn the workspace on: BOTH switches (app flag + engine context) as production requires. */
function workspaceOn(context = aFindingContext()) {
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  api.getFindingContext.mockResolvedValue(context);
}

/**
 * The decision dropdown, found the way a customer identifies it: the select whose
 * options are decision states. Never by test id — the control is the contract.
 */
function decisionSelect(container: HTMLElement): HTMLSelectElement {
  const found = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).every((o) =>
      (DECISION_STATES as readonly string[]).includes(o.value)
    )
  );
  if (!found) throw new Error("No decision-state select rendered.");
  return found as HTMLSelectElement;
}

const optionLabels = (s: HTMLSelectElement) =>
  Array.from(s.options).map((o) => (o.textContent ?? "").trim());

/** Every option offered anywhere on the page — what the user can actually SET. */
const allOptionLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("option")).map((o) => (o.textContent ?? "").trim());

async function openRemediationTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Remediation" }));
  // The evidence section loads on mount; flush it so the tab is fully settled.
  await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getFinding.mockResolvedValue({ finding: aFinding() });
  api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
  api.getFindingContext.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({
    members: [
      { id: "user-1", email: "ana@example.com", name: "Ana Ops", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
    ],
    pending_invites: [],
    seat_usage: { used: 1, max: 5 },
  });
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
});

// ─────────────────────────────────────────────────────────────────────
// 1. Business impact / affected context — the four honest-emptiness states
// ─────────────────────────────────────────────────────────────────────

describe("Decision Workspace — emptiness never lies", () => {
  it("a RESOLVER FAILURE renders as ignorance, not as a zero (#637)", async () => {
    workspaceOn(
      aFindingContext({
        affected: {
          vendors: [],
          ai_systems: [],
          controls: [],
          obligations: [],
          resolution: {
            vendors: "resolver_error",
            ai_systems: "none_found",
            controls: "none_found",
            obligations: "none_found",
          },
          candidates: [],
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    // The whole point: an operator must not read "we could not look" as "there is
    // nothing there". The copy says so, and it is amber, not grey.
    const failure = screen.getByText(
      "Could not resolve — this is not a zero. Retry, or escalate if it persists."
    );
    expect(failure).toBeInTheDocument();
    expect(failure).toHaveStyle({ color: "rgb(251, 191, 36)" });

    // The Vendors group specifically must NOT claim an honest zero.
    const vendorsGroup = screen
      .getByText(/^Vendors \(0\)$/)
      .parentElement as HTMLElement;
    expect(within(vendorsGroup).queryByText("None found")).toBeNull();

    // …and it must not have been laundered into a headline of "Low" or "0" either.
    expect(container.textContent).not.toContain("Business impact: Low");
  });

  it("NOT APPLICABLE, NONE FOUND and RESOLVER FAILURE are three different sentences", async () => {
    workspaceOn(
      aFindingContext({
        affected: {
          vendors: [],
          ai_systems: [],
          controls: [],
          obligations: [{ type: "obligation", id: "o-1", name: "HIPAA §164.312" }],
          resolution: {
            vendors: "resolver_error",
            ai_systems: "not_applicable",
            controls: "none_found",
            obligations: "resolved",
          },
          candidates: [],
        },
      })
    );

    await renderPage(FindingDetailPage, props());

    // Four buckets, four outcomes, four distinct renderings on one screen. If any two
    // of these ever collapse, the panel is lying about one of them.
    expect(
      screen.getByText(
        "Could not resolve — this is not a zero. Retry, or escalate if it persists."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not resolvable from this finding's source")
    ).toBeInTheDocument();
    expect(screen.getByText("None found")).toBeInTheDocument(); // exactly one bucket
    expect(screen.getByRole("link", { name: "HIPAA §164.312" })).toHaveAttribute(
      "href",
      "/obligations/o-1"
    );
  });

  it("UNASSESSED impact reads 'Not assessed' — it is never floored to Low", async () => {
    workspaceOn(); // fixture default: every dimension not_assessed

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Business impact: Not assessed")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Business impact: Low");
    expect(container.textContent).not.toContain("Business impact: None");
    // The headline must agree with the rows beneath it — that contradiction is the
    // bug businessImpact.ts was extracted to kill.
    expect(screen.getAllByText("Not assessed")).toHaveLength(3);
  });

  it("an ASSESSED ZERO reads 'None' — distinct from 'Not assessed', and not 'Low'", async () => {
    workspaceOn(
      aFindingContext({
        business_impact: {
          operational: { level: "none", note: "No production systems affected." },
          regulatory: { level: "none", note: "No regulated data in scope." },
          third_party: { level: "none", note: "No vendor dependency." },
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Business impact: None")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Business impact: Not assessed");
    expect(container.textContent).not.toContain("Business impact: Low");
    expect(screen.getByText("No production systems affected.")).toBeInTheDocument();
  });

  it("a KNOWN impact dominates the unknowns — the headline is the highest real level", async () => {
    workspaceOn(
      aFindingContext({
        business_impact: {
          operational: { level: "high", note: "Payment processing degraded." },
          regulatory: { level: "not_assessed", note: "" },
          third_party: { level: "none", note: "" },
        },
      })
    );

    await renderPage(FindingDetailPage, props());

    // A high dimension may never be hidden behind "Not assessed".
    expect(screen.getByText("Business impact: High")).toBeInTheDocument();
    expect(screen.getByText("Payment processing degraded.")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Two axes: operational_status is derived, decision_state is decided
// ─────────────────────────────────────────────────────────────────────

describe("Decision Workspace — the two axes", () => {
  it("operational_status is DISPLAYED, never offered as a control", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "mitigating",
          operational_status: "in_progress",
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    // It is shown, so a decision-maker can see where the work actually is…
    expect(screen.getByText("Work in progress")).toBeInTheDocument();

    // …and it is NOT settable. It is derived from the linked Actions (lifecycle spec
    // §1.1); a hand-set control here would let a human assert remediation that never
    // happened.
    const settable = allOptionLabels(container);
    for (const label of ["Work not started", "Work in progress", "Remediation complete"]) {
      expect(settable).not.toContain(label);
    }
    expect(screen.getByText("Work in progress").tagName).not.toBe("OPTION");
    expect(screen.getByText("Work in progress").closest("select")).toBeNull();
    expect(screen.getByText("Work in progress").closest("button")).toBeNull();
  });

  it("needs_review + work not started: Resolved is NOT offered (no dead control)", async () => {
    workspaceOn(); // needs_review / operational open

    const { container } = await renderPage(FindingDetailPage, props());

    // Closing requires derived remediation or an accepted-risk override. Offering
    // "Resolved" here would be a control the server 409s — the defect class.
    expect(optionLabels(decisionSelect(container))).toEqual([
      "Needs Review",
      "Mitigating",
      "Accepted Risk",
    ]);
  });

  it("once the work is REMEDIATED, Resolved becomes offerable", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "mitigating",
          operational_status: "remediated",
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Remediation complete")).toBeInTheDocument();
    expect(optionLabels(decisionSelect(container))).toEqual([
      "Mitigating",
      "Accepted Risk",
      "Resolved",
    ]);
  });

  it("accepted_risk may be closed without remediation, and is not re-offered to itself", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "accepted_risk",
          operational_status: "open",
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    const labels = optionLabels(decisionSelect(container));
    expect(labels).toEqual(["Accepted Risk", "Resolved"]);
    expect(labels).not.toContain("Mitigating"); // accepted_risk → mitigating is illegal
  });

  it("a resolved finding offers reopen, and never a second close", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "resolved",
          operational_status: "remediated",
        },
      })
    );

    const { container } = await renderPage(FindingDetailPage, props());

    expect(optionLabels(decisionSelect(container))).toEqual([
      "Needs Review",
      "Accepted Risk",
      "Resolved",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Remediation state reflects the linked Actions
// ─────────────────────────────────────────────────────────────────────

describe("Decision Workspace — remediation reflects the linked actions", () => {
  it("no actions: an honest zero AND a next step, not a dead end", async () => {
    workspaceOn();
    api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));

    await renderPage(FindingDetailPage, props());
    await openRemediationTab();

    expect(screen.getByText("Remediation Actions (0)")).toBeInTheDocument();
    expect(screen.getByText("No remediation actions yet.")).toBeInTheDocument();
    // The empty state must hand the user the next move.
    expect(
      screen.getByText("Add an action to track remediation work for this finding.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add Remediation Action" })
    ).toBeInTheDocument();

    // Same for the evidence gate: the empty state says what artifact to bring.
    expect(screen.getByText("No evidence attached.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Attach the artifact that proves this work was done — a change ticket, a deployment log, a screenshot."
      )
    ).toBeInTheDocument();
  });

  it("open actions: the work is listed, counted, and advanceable", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "mitigating",
          operational_status: "in_progress",
        },
      })
    );
    api.getActionsForFinding.mockResolvedValue(
      anActionsResponse([
        anAction({ id: "a-1", title: "Enable SSE-KMS", status: "open" }),
        anAction({ id: "a-2", title: "Rotate backup keys", status: "in_progress" }),
      ])
    );

    await renderPage(FindingDetailPage, props());
    await openRemediationTab();

    expect(screen.getByText("Remediation Actions (2)")).toBeInTheDocument();
    expect(screen.getByText("Enable SSE-KMS")).toBeInTheDocument();
    expect(screen.getByText("Rotate backup keys")).toBeInTheDocument();
    // An open action can be started; an in-progress one can be completed.
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();

    // And the derived axis agrees with the work: it is in progress, not remediated.
    expect(screen.getByText("Work in progress")).toBeInTheDocument();
    expect(screen.queryByText("Remediation complete")).toBeNull();
  });

  it("remediated: closed actions, the derived chip, and the close now available", async () => {
    workspaceOn(
      aFindingContext({
        finding: {
          id: "f-1",
          source_type: "manual",
          source_id: null,
          decision_state: "mitigating",
          operational_status: "remediated",
        },
      })
    );
    api.getActionsForFinding.mockResolvedValue(
      anActionsResponse([
        anAction({
          id: "a-1",
          title: "Enable SSE-KMS",
          status: "closed",
          completed_at: "2026-06-02T00:00:00.000Z",
        }),
      ])
    );

    const { container } = await renderPage(FindingDetailPage, props());

    // The whole chain has to line up: the action is closed → operational_status is
    // remediated → the decision may now be closed.
    expect(screen.getByText("Remediation complete")).toBeInTheDocument();
    expect(optionLabels(decisionSelect(container))).toContain("Resolved");

    await openRemediationTab();
    expect(screen.getByText("Remediation Actions (1)")).toBeInTheDocument();
    // The action's own status badge (not the finding-status <option> of the same
    // word, nor the "Closed" stage label in the lifecycle stepper).
    expect(
      screen
        .getAllByText("Closed")
        .filter((el) => el.tagName === "SPAN" && !el.closest('[aria-label="Finding lifecycle"]'))
    ).toHaveLength(1);
    expect(screen.getByText(/Completed Jun 2, 2026/)).toBeInTheDocument();
  });

  it("Overview's empty evidence state routes to where evidence is attached", async () => {
    workspaceOn();

    const { container } = await renderPage(FindingDetailPage, props());

    // Overview REPORTS evidence; Remediation is where it is ATTACHED. Without the
    // pointer the empty state is a dead end — and for a gate-enforcing org it is the
    // thing blocking remediation.
    expect(container.textContent).toContain("No evidence attached — add it in the");
    fireEvent.click(screen.getByRole("button", { name: "Remediation tab" }));

    await waitFor(() =>
      expect(screen.getByText("Remediation Actions (0)")).toBeInTheDocument()
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Authorization
// ─────────────────────────────────────────────────────────────────────

describe("/findings/[id] — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(FindingDetailPage, props())).toBe("/login");
  });

  it("a caller the engine will not serve is sent back to /findings, never shown a shell", async () => {
    // The page holds no entitlement gate of its own: the ENGINE is the authority, and a
    // 403/404 surfaces as a null finding. The honest outcome is the list, not an empty
    // workspace rendered around a finding the caller may not see.
    workspaceOn();
    api.getFinding.mockResolvedValue(null);

    expect(await expectRedirect(FindingDetailPage, props())).toBe("/findings");
  });

  it("an API-key caller is served the page (no user identity required to decide)", async () => {
    signedIn({ jwtToken: undefined, apiKey: "test-key", userId: undefined });
    workspaceOn();

    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Feature flag — legacy vs workspace, and no mixed state
// ─────────────────────────────────────────────────────────────────────

describe("/findings/[id] — SECURELOGIC_DECISION_WORKSPACE_ENABLED", () => {
  it("flag OFF renders the legacy detail and never asks for context", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Status & Priority")).toBeInTheDocument();
    expect(screen.getByText("Finding Details")).toBeInTheDocument();
    expect(screen.getByText("Remediation Actions (0)")).toBeInTheDocument();
    // No workspace: no tabs, no decision axis, no business-impact headline.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container.textContent).not.toContain("Business impact");
    expect(api.getFindingContext).not.toHaveBeenCalled();
  });

  it("flag ON renders the workspace and NOT the legacy sidebar (no mixed state)", async () => {
    workspaceOn();

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Remediation" })).toBeInTheDocument();
    expect(decisionSelect(container)).toBeInTheDocument();
    expect(screen.getByText("Risk 61/100 (High)")).toBeInTheDocument();
    // The legacy sidebar must be gone: two status controls on one page is two truths.
    expect(screen.queryByText("Status & Priority")).toBeNull();
    expect(screen.queryByText("Finding Details")).toBeNull();
  });

  it("flag ON but the engine returns no context: legacy, not a half-built workspace", async () => {
    // Two-switch: the app flag alone is not enough. If the engine's context route is
    // dark, the page must fall back whole — not render a workspace with empty zones.
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    api.getFindingContext.mockResolvedValue(null);

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Status & Priority")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container.textContent).not.toContain("Business impact");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Walkthrough remediation — governance clarity, explainability, actionable links
// ─────────────────────────────────────────────────────────────────────

describe("Decision Workspace — walkthrough remediation (PR-B1)", () => {
  it("names the two axes explicitly and shows a lifecycle indicator (DW-1 / R-21)", async () => {
    workspaceOn();
    const { container } = await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Governance Decision")).toBeInTheDocument();
    expect(screen.getByText("Operational Status")).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Finding lifecycle"]')).not.toBeNull();
  });

  it("states the governance hand-off when remediation is complete but undecided (R-19/R-22)", async () => {
    workspaceOn(
      aFindingContext({
        finding: { id: "f-1", source_type: "manual", source_id: null, decision_state: "needs_review", operational_status: "remediated" },
      }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Remediation complete. Governance decision required.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Record decision/i })).toBeInTheDocument();
  });

  it("arriving from the Ready to Close queue shows the hand-off even before the state re-derives (?from=, R-19)", async () => {
    // The queue card links /findings/{id}?from=ready_to_close; the workspace
    // must honor that context on its own — this drives the fromQueue branch,
    // not the operational_status one (state here is NOT remediated).
    setClientSearchParams("from=ready_to_close");
    workspaceOn(
      aFindingContext({
        finding: { id: "f-1", source_type: "manual", source_id: null, decision_state: "needs_review", operational_status: "in_progress" },
      }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Remediation complete. Governance decision required.")).toBeInTheDocument();
  });

  // ── Originating-queue provenance banner (new-tab handoff, R-19) ──────────
  // The default context (operational_status "open") is NOT governance-pending, so
  // these exercise the provenance branch: name the queue + link back, from the URL
  // alone (a new tab has no history/memory to fall back on).

  it("names the originating queue on arrival from All Findings — 'Opened from All Findings'", async () => {
    setClientSearchParams("from=findings_queue");
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Opened from All Findings")).toBeInTheDocument();
  });

  it("names the originating Operations Center bucket — 'Opened from Needs Governance Decision'", async () => {
    setClientSearchParams("from=needs_decision");
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Opened from Needs Governance Decision")).toBeInTheDocument();
  });

  it("offers an exact back-link that restores the filtered/paginated queue (?return=)", async () => {
    setClientSearchParams(
      "from=findings_queue&return=" + encodeURIComponent("/findings?q=azure&severity=Critical&page=2"),
    );
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.getByRole("link", { name: /Back to All Findings/i })).toHaveAttribute(
      "href",
      "/findings?q=azure&severity=Critical&page=2",
    );
  });

  it("falls back to the canonical bucket URL when no ?return= is supplied", async () => {
    setClientSearchParams("from=needs_decision");
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.getByRole("link", { name: /Back to Needs Governance Decision/i })).toHaveAttribute(
      "href",
      "/findings?bucket=needs_decision",
    );
  });

  it("a malformed or unsupported from value shows NO handoff banner (fails safe)", async () => {
    setClientSearchParams("from=" + encodeURIComponent("<script>alert(1)</script>"));
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.queryByText(/Opened from/)).toBeNull();
    expect(screen.queryByText("Remediation complete. Governance decision required.")).toBeNull();
  });

  it("direct detail-page navigation with no handoff context shows no banner", async () => {
    // No setClientSearchParams → empty URL; default context is not governance-pending.
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.queryByText(/Opened from/)).toBeNull();
    expect(screen.queryByText("Remediation complete. Governance decision required.")).toBeNull();
  });

  it("tenant isolation: a hostile ?return= is never turned into a live link (no open redirect)", async () => {
    // The finding itself is fetched org-scoped SERVER-side (existing isolation lanes);
    // the handoff params carry no authority. Here we prove the one navigational
    // surface they touch — the back-link — can't be pointed off-origin.
    setClientSearchParams(
      "from=findings_queue&return=" + encodeURIComponent("https://evil.example/steal"),
    );
    workspaceOn();
    const { container } = await renderPage(FindingDetailPage, props());
    // Provenance banner still renders (from is valid) ...
    expect(screen.getByText("Opened from All Findings")).toBeInTheDocument();
    // ... but the unsafe return is rejected and no link points at the hostile host;
    // the back-link falls back to the safe canonical queue URL.
    expect(container.querySelector('a[href*="evil.example"]')).toBeNull();
    expect(screen.getByRole("link", { name: /Back to All Findings/i })).toHaveAttribute(
      "href",
      "/findings?queue=all",
    );
  });

  it("defines Confidence where it is shown (DW-5)", async () => {
    workspaceOn();
    const { container } = await renderPage(FindingDetailPage, props());
    const chip = Array.from(container.querySelectorAll("[title]")).find((el) =>
      el.getAttribute("title")?.startsWith("Confidence ="),
    );
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("title")).toContain("discounts the risk score when low");
  });

  it("'Mark reviewed by me' says it is a personal bookmark, never a lifecycle action", async () => {
    workspaceOn();
    await renderPage(FindingDetailPage, props());
    expect(screen.getByRole("button", { name: "Mark reviewed by me" })).toBeInTheDocument();
    expect(
      screen.getByText(/It does not change the governance decision, operational status, or any queue/),
    ).toBeInTheDocument();
  });

  it("surfaces the risk-score explainability the engine already returns (DW-4)", async () => {
    workspaceOn(
      aFindingContext({ risk: { score: 74, band: "High", rationale: ["Severity High → base 70", "Priority immediate → +10", "Confidence 80 → −6"] } }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText(/Why 74\/100\?/)).toBeInTheDocument();
    expect(screen.getByText("Priority immediate → +10")).toBeInTheDocument();
  });

  it("makes Suggested Links show match reason + score and explains the consequence (DW-6)", async () => {
    workspaceOn(
      aFindingContext({
        affected: {
          vendors: [], ai_systems: [], controls: [], obligations: [],
          candidates: [{ type: "vendor", id: "v-9", name: "Globex Cloud", match_reason: "vendor name match", match_score: 82, status: "needs_review" }],
        },
      }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText("Match 82/100")).toBeInTheDocument();
    expect(screen.getByText(/vendor name match/)).toBeInTheDocument();
    expect(screen.getByText(/Accept to confirm the link/i)).toBeInTheDocument();
  });

  it("makes evidence with a URL reference openable and never a dead row (DW-7/B-12)", async () => {
    workspaceOn(
      aFindingContext({
        evidence: [{ id: "e-1", title: "Penetration test report", evidence_type: "external_report", external_ref: "https://example.com/pentest.pdf", collected_at: "2026-06-01T00:00:00.000Z", created_at: "2026-06-01T00:00:00.000Z" }],
      }),
    );
    const { container } = await renderPage(FindingDetailPage, props());
    const link = container.querySelector('a[href="https://example.com/pentest.pdf"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("links a business-impact dimension to its underlying entities (B-11)", async () => {
    workspaceOn(
      aFindingContext({
        business_impact: {
          operational: { level: "high", note: "Two controls exposed" },
          regulatory: { level: "not_assessed", note: "" },
          third_party: { level: "not_assessed", note: "" },
        },
        affected: {
          vendors: [], ai_systems: [],
          controls: [{ type: "control", id: "c-1", name: "Access Control" }],
          obligations: [], candidates: [],
        },
      }),
    );
    await renderPage(FindingDetailPage, props());
    // The business-impact row's link is prefixed with its entity type, distinguishing
    // it from the same entity listed in Zone D (Affected context).
    const link = screen.getByRole("link", { name: /Control:\s*Access Control/ });
    expect(link).toHaveAttribute("href", "/controls/c-1");
  });

  it("humanizes activity into workflow transitions (DW-9)", async () => {
    workspaceOn(
      aFindingContext({
        activity: [{ event_type: "finding.decision.accepted_risk", created_at: "2026-06-10T00:00:00.000Z", payload: null }],
      }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText(/Governance: risk accepted/)).toBeInTheDocument();
    expect(screen.queryByText(/finding\.decision\.accepted_risk/)).toBeNull();
  });

  it("the feed includes remediation + reassignment history — action events, humanized (R-9)", async () => {
    // The engine writes action.status_changed / action.updated (with the
    // resulting state in the payload); the feed labels them as remediation
    // transitions and reassignments, never raw enums.
    workspaceOn(
      aFindingContext({
        activity: [
          { event_type: "action.status_changed", created_at: "2026-06-12T00:00:00.000Z", payload: { status: "closed" } },
          { event_type: "action.status_changed", created_at: "2026-06-11T00:00:00.000Z", payload: { status: "blocked" } },
          { event_type: "action.updated", created_at: "2026-06-10T00:00:00.000Z", payload: { status: "in_progress", owner_user_id: "u-2" } },
          { event_type: "action.created", created_at: "2026-06-09T00:00:00.000Z", payload: null },
        ],
      }),
    );
    await renderPage(FindingDetailPage, props());
    expect(screen.getByText(/Remediation action completed/)).toBeInTheDocument();
    expect(screen.getByText(/Remediation action blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Remediation action updated \(owner \/ due date \/ details\)/)).toBeInTheDocument();
    expect(screen.getByText(/Remediation action added/)).toBeInTheDocument();
    expect(screen.queryByText(/action\.status_changed/)).toBeNull();
  });

  it("shows remediation completion progress in the Remediation tab (R-4)", async () => {
    workspaceOn();
    api.getActionsForFinding.mockResolvedValue(
      anActionsResponse([
        anAction({ id: "a-1", status: "closed", completed_at: "2026-06-02T00:00:00.000Z" }),
        anAction({ id: "a-2", status: "in_progress" }),
      ]),
    );
    await renderPage(FindingDetailPage, props());
    await openRemediationTab();
    expect(screen.getByText(/1 of 2 complete/)).toBeInTheDocument();
    expect(screen.getByText(/1 remaining/)).toBeInTheDocument();
  });

  it("when the last action completes, the progress line hands off to governance (R-22)", async () => {
    workspaceOn();
    api.getActionsForFinding.mockResolvedValue(
      anActionsResponse([
        anAction({ id: "a-1", status: "closed", completed_at: "2026-06-02T00:00:00.000Z" }),
        anAction({ id: "a-2", status: "closed", completed_at: "2026-06-03T00:00:00.000Z" }),
      ]),
    );
    await renderPage(FindingDetailPage, props());
    await openRemediationTab();
    expect(
      screen.getByText(/All 2 actions complete — remediation done\. Next: record the governance decision/),
    ).toBeInTheDocument();
  });

  it("labels the recommendation as advisory and the actions as executable (R-3)", async () => {
    workspaceOn();
    api.getActionsForFinding.mockResolvedValue(anActionsResponse([anAction({ id: "a-1" })]));
    await renderPage(FindingDetailPage, props());
    await openRemediationTab();
    // The walkthrough read the recommendation text as a to-do; the two blocks
    // now name their nature explicitly.
    expect(screen.getByText("Advisory guidance")).toBeInTheDocument();
    expect(screen.getByText(/Executable — tracked to completion/)).toBeInTheDocument();
  });

  it("makes evidence with a URL reference openable in the Remediation tab (R-2)", async () => {
    workspaceOn();
    api.getFindingEvidence.mockResolvedValue({
      ok: true,
      evidence: [{ id: "e-1", title: "Change ticket", evidence_type: "document", external_ref: "https://tickets.example.com/CR-1042", created_at: "2026-06-01T00:00:00.000Z" }],
    });
    const { container } = await renderPage(FindingDetailPage, props());
    await openRemediationTab();
    const link = container.querySelector('a[href="https://tickets.example.com/CR-1042"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
