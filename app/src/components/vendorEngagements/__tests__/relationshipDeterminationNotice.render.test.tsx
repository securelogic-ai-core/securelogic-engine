/**
 * RelationshipDeterminationNotice — WA-3 / R8 render contract.
 *
 * The owner's behavioural requirement, asserted on the surface rather than
 * only in the engine: an analyst must be able to see that the basis is stale,
 * see exactly what changed, rebase it deliberately with a reason while the
 * engagement is still pre-issue — and must NOT be offered that action once the
 * engagement is issued, where the basis is history.
 *
 * The arm that matters most is the issued one. The engine refuses a post-issue
 * reseed regardless, but a surface that renders the button anyway teaches an
 * analyst that the action exists and then fails them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { clientRouter } from "@/test/harness";

const actions = vi.hoisted(() => ({ reseedFromRelationship: vi.fn() }));
vi.mock("@/app/actions/vendorEngagements", () => actions);

import RelationshipDeterminationNotice from "../RelationshipDeterminationNotice";
import type { VendorEngagementRelationshipDetermination } from "@/lib/api";

const CHANGED: VendorEngagementRelationshipDetermination = {
  stale: true,
  indeterminate: false,
  reseedable: true,
  changed_fields: [
    { field: "data_sensitivity", engagement_value: "restricted", relationship_value: "none" },
    { field: "assessment_tier", engagement_value: "tier_1_critical", relationship_value: "tier_4_low" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  clientRouter.refresh.mockReset?.();
});

const renderNotice = (d: VendorEngagementRelationshipDetermination | null) =>
  render(<RelationshipDeterminationNotice engagementId="eng-1" determination={d} />);

describe("R8 — the analyst can see that the basis has moved", () => {
  it("renders nothing when the basis is current", () => {
    const { container } = renderNotice({ stale: false, indeterminate: false, reseedable: true, changed_fields: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the engine did not send the envelope (older engine, rolling deploy)", () => {
    const { container } = renderNotice(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("says what changed, old value beside new", async () => {
    renderNotice(CHANGED);
    expect(screen.getByText(/relationship has been re-assessed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/What changed \(2 fields\)/i));
    expect(screen.getByText("Data sensitivity")).toBeInTheDocument();
    expect(screen.getByText("Assessment tier")).toBeInTheDocument();
    expect(screen.getByText("restricted")).toBeInTheDocument();
    expect(screen.getByText("tier 4 low")).toBeInTheDocument();
  });

  it("reports an indeterminate relationship as 'cannot tell', never as stale", () => {
    renderNotice({ stale: false, indeterminate: true, changed_fields: [], reason: "relationship_inactive" });
    expect(screen.getByText(/cannot tell whether the assessment basis is current/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("R8 — the rebase is deliberate, reasoned, and pre-issue only", () => {
  it("requires a reason of at least ten characters before the action is available", () => {
    renderNotice(CHANGED);
    const button = screen.getByRole("button", { name: /Rebase onto current determination/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why are you rebasing/i), { target: { value: "too short" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why are you rebasing/i), {
      target: { value: "Scope reduced to a read-only reporting feed." },
    });
    expect(button).toBeEnabled();
  });

  it("submits the reason and shows the engine's next step rather than recomposing", async () => {
    actions.reseedFromRelationship.mockResolvedValue({
      ok: true,
      changed: [{ field: "assessment_tier", from: "tier_1_critical", to: "tier_4_low" }],
      nextStep: "Run the composition to see the question set these facts produce before it replaces the current scope.",
    });
    renderNotice(CHANGED);
    fireEvent.change(screen.getByLabelText(/Why are you rebasing/i), {
      target: { value: "Scope reduced to a read-only reporting feed." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rebase onto current determination/i }));

    await waitFor(() =>
      expect(actions.reseedFromRelationship).toHaveBeenCalledWith(
        "eng-1",
        "Scope reduced to a read-only reporting feed."
      )
    );
    expect(await screen.findByText(/Run the composition to see the question set/i)).toBeInTheDocument();
  });

  it("keeps the confirmation on screen after the refresh clears staleness", async () => {
    // The component is rendered by a server page. On success it calls
    // router.refresh(), and the fresh data says the basis is no longer stale —
    // so a naive `if (!stale) return null` unmounts the component by its own
    // success and the analyst's next-step guidance vanishes mid-read. The
    // deployed-staging journey caught it as an intermittently cancelled POST.
    actions.reseedFromRelationship.mockResolvedValue({
      ok: true,
      changed: [{ field: "assessment_tier", from: "tier_1_critical", to: "tier_4_low" }],
      nextStep: "Run the composition to see the question set these facts produce.",
    });
    const { rerender } = renderNotice(CHANGED);
    fireEvent.change(screen.getByLabelText(/Why are you rebasing/i), {
      target: { value: "Scope reduced to a read-only reporting feed." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rebase onto current determination/i }));
    // `role="status"` is the confirmation specifically. Matching on the words
    // alone would also hit the form's static "you will still run the
    // composition" hint and prove nothing.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/these facts produce/i));

    // The server re-renders with the basis now current.
    rerender(
      <RelationshipDeterminationNotice
        engagementId="eng-1"
        determination={{ stale: false, indeterminate: false, reseedable: true, changed_fields: [] }}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/these facts produce/i);
    // ...and the stale banner is correctly gone.
    expect(screen.queryByText(/relationship has been re-assessed/i)).not.toBeInTheDocument();
  });

  it("surfaces a refusal without claiming anything changed", async () => {
    actions.reseedFromRelationship.mockResolvedValue({
      ok: false,
      error: "The request did not reach SecureLogic, so nothing was changed.",
    });
    renderNotice(CHANGED);
    fireEvent.change(screen.getByLabelText(/Why are you rebasing/i), {
      target: { value: "Rebasing after the corrected intake." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rebase onto current determination/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was changed/i);
  });

  it("ISSUED: shows what changed but offers NO rebase, and says to open a new engagement", () => {
    renderNotice({ ...CHANGED, reseedable: false });
    // The analyst is still told the relationship moved...
    expect(screen.getByText(/relationship has been re-assessed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/What changed/i));
    expect(screen.getByText("Assessment tier")).toBeInTheDocument();
    // ...and is pointed at the only correct route, not at a button that would fail.
    expect(screen.getByText(/open a new engagement/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rebase/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Why are you rebasing/i)).not.toBeInTheDocument();
  });
});
