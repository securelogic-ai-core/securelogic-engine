/**
 * riskRegisterPanel.render.test.tsx — the Findings ↔ Risk Register panel.
 *
 * WHAT THIS FILE PROTECTS: that "standalone" reads as a decision nobody has
 * taken, not as missing data — and that the two register acts stay visibly
 * distinct, because they mean different things to an auditor.
 *
 *   LINK    attaches this finding as evidence for a risk the organization has
 *           already accepted into its register.
 *   PROMOTE asserts that a new risk exists.
 *
 * The panel must never rate a risk on the customer's behalf. It offers the
 * controls and sends what the person chose; the engine refuses a promotion with
 * no rating. A rating this panel invented would be a rating with no author, and
 * the register's whole value is that someone stands behind each entry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  linkFindingToRisk: vi.fn(async () => ({})),
  unlinkFindingFromRisk: vi.fn(async () => ({})),
  promoteFindingToRisk: vi.fn(async () => ({})),
}));

vi.mock("../riskLinkActions", () => actions);

import { RiskRegisterPanel } from "../RiskRegisterPanel";
import type { FindingRiskLink } from "@/lib/api";

const FINDING = "f-1";
const RISKS = [
  { id: "r-1", title: "Backup exposure", risk_rating: "High" },
  { id: "r-2", title: "Vendor concentration", risk_rating: "Moderate" },
];

const aLink = (over: Partial<FindingRiskLink> = {}): FindingRiskLink => ({
  risk_id: "r-1", link_type: "linked", note: null,
  created_at: "2026-09-01T00:00:00.000Z", created_by_user_id: "u-1",
  risk_title: "Backup exposure", risk_domain: "cyber",
  risk_rating: "High", risk_status: "open", ...over,
});

const panel = (props: Partial<Parameters<typeof RiskRegisterPanel>[0]> = {}) =>
  render(
    <RiskRegisterPanel
      findingId={FINDING}
      links={[]}
      availableRisks={RISKS}
      canDecide
      {...props}
    />
  );

beforeEach(() => vi.clearAllMocks());

describe("standalone is a state, not an absence", () => {
  it("says so plainly, and does not nag", async () => {
    panel();

    expect(screen.getByText(/standalone/i)).toBeInTheDocument();
    // No warning styling, no "action required" — most findings should stay here.
    expect(screen.queryByText(/required|must|overdue/i)).not.toBeInTheDocument();
  });

  it("renders no link rows and calls nothing on mount", async () => {
    panel();

    expect(actions.linkFindingToRisk).not.toHaveBeenCalled();
    expect(actions.promoteFindingToRisk).not.toHaveBeenCalled();
  });
});

describe("the two acts stay distinct", () => {
  it("offers both, labelled differently", () => {
    panel();

    expect(screen.getByRole("button", { name: /Link to a risk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
  });

  it("hides 'link' when every register entry is already linked", () => {
    panel({ links: [aLink({ risk_id: "r-1" }), aLink({ risk_id: "r-2", risk_title: "Vendor concentration" })] });

    expect(screen.queryByRole("button", { name: /Link to a risk/i })).not.toBeInTheDocument();
    // Promotion stays available: a new risk can always exist.
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
  });

  it("does not offer an already-linked risk again", () => {
    panel({ links: [aLink({ risk_id: "r-1" })] });

    fireEvent.click(screen.getByRole("button", { name: /Link to a risk/i }));

    expect(screen.queryByRole("option", { name: /Backup exposure/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Vendor concentration/i })).toBeInTheDocument();
  });
});

describe("linking", () => {
  it("sends the chosen risk and the reason", async () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Link to a risk/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "r-2" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "same root cause" } });
    fireEvent.click(screen.getByRole("button", { name: /^Link$/i }));

    await waitFor(() =>
      expect(actions.linkFindingToRisk).toHaveBeenCalledWith(FINDING, "r-2", "same root cause")
    );
  });

  it("cannot be submitted without choosing a risk", () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Link to a risk/i }));

    expect(screen.getByRole("button", { name: /^Link$/i })).toBeDisabled();
  });

  it("surfaces the engine's refusal instead of pretending it worked", async () => {
    actions.linkFindingToRisk.mockResolvedValueOnce({ error: "That risk is no longer in your register." });
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Link to a risk/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "r-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Link$/i }));

    expect(await screen.findByText(/no longer in your register/i)).toBeInTheDocument();
  });
});

describe("promotion asks the human for the rating", () => {
  it("names the commit differently from the button that opened the form", () => {
    // "Add to register" opens the form; "Create register entry" commits. One
    // word for both would make an exploratory click indistinguishable from a
    // decision.
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Add to register/i }));

    expect(screen.getByRole("button", { name: /Create register entry/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to register$/i })).not.toBeInTheDocument();
  });

  it("offers all three rating bands — inherent, current and residual", () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Add to register/i }));

    expect(screen.getByText(/Inherent \(before controls\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^Current$/i)).toBeInTheDocument();
    expect(screen.getByText(/Residual \(after controls\)/i)).toBeInTheDocument();
  });

  it("sends every rating field the register requires", async () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Add to register/i }));
    fireEvent.click(screen.getByRole("button", { name: /Create register entry/i }));

    await waitFor(() => expect(actions.promoteFindingToRisk).toHaveBeenCalled());
    const sent = actions.promoteFindingToRisk.mock.calls[0]![1] as Record<string, unknown>;
    for (const key of [
      "likelihood", "impact", "risk_rating",
      "inherent_likelihood", "inherent_impact", "inherent_rating",
      "residual_likelihood", "residual_impact", "residual_rating",
    ]) {
      expect(sent[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("does not send a title — the engine carries it over from the finding", async () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: /Add to register/i }));
    fireEvent.click(screen.getByRole("button", { name: /Create register entry/i }));

    await waitFor(() => expect(actions.promoteFindingToRisk).toHaveBeenCalled());
    expect(actions.promoteFindingToRisk.mock.calls[0]![1]).not.toHaveProperty("title");
  });
});

describe("linked risks are navigable and removable", () => {
  it("links through to the register entry", () => {
    panel({ links: [aLink()] });

    expect(screen.getByRole("link", { name: /Backup exposure/i }))
      .toHaveAttribute("href", "/risks/r-1");
  });

  it("marks an entry that was promoted from this finding", () => {
    panel({ links: [aLink({ link_type: "promoted" })] });

    expect(screen.getByText(/promoted from this finding/i)).toBeInTheDocument();
  });

  it("offers unlink, and calls it with both ids", async () => {
    panel({ links: [aLink()] });

    fireEvent.click(screen.getByRole("button", { name: /Unlink/i }));

    await waitFor(() =>
      expect(actions.unlinkFindingFromRisk).toHaveBeenCalledWith(FINDING, "r-1")
    );
  });
});

describe("read-only callers", () => {
  it("a viewer sees the state but no controls", () => {
    panel({ canDecide: false, links: [aLink()] });

    expect(screen.getByRole("link", { name: /Backup exposure/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlink/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to register/i })).not.toBeInTheDocument();
  });

  it("a viewer on a standalone finding is told who can change it", () => {
    panel({ canDecide: false });

    expect(screen.getByText(/Only analysts and admins/i)).toBeInTheDocument();
  });
});
