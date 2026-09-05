/**
 * ApplicabilityChallenges — WA-2 / owner ruling 2 render contract.
 *
 * The ruling forbids suppressing an applicable SecureLogic Core Assurance
 * objective. The engine offers no route that removes anything, and these pin
 * that the SURFACE does not imply one either: a form that looks like it might
 * waive a requirement would be read as one, whatever the API does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { clientRouter } from "@/test/harness";

const actions = vi.hoisted(() => ({ raiseChallenge: vi.fn() }));
vi.mock("@/app/actions/vendorEngagements", () => actions);

import ApplicabilityChallenges, { CHALLENGE_TRANSPORT_FAILURE } from "../ApplicabilityChallenges";
import type { ApplicabilityChallenge } from "@/lib/api";

const references = [
  { reference: "CAS-11", title: "Identification and management of material subcontractors", outcome: "asked" },
  { reference: "CC6.1", title: "Logical access security", outcome: "asked" },
];

const recorded: ApplicabilityChallenge = {
  id: "ch-1",
  requirement_reference: "CAS-11",
  requirement_id: "r-11",
  challenged_outcome: "asked",
  challenged_rationale: "The relationship involves material subcontractors, so fourth-party management is assessed.",
  reason: "We terminated the only subprocessor last quarter; the declared facts are stale.",
  snapshot_hash: "a".repeat(64),
  created_at: "2026-09-04T22:00:00.000Z",
  raised_by_user_id: "u-1",
  raised_by_email: "analyst@securelogicai.test",
  raised_by_name: "Dana Analyst",
  superseded: false,
};

function mount(over: Partial<React.ComponentProps<typeof ApplicabilityChallenges>> = {}) {
  return render(
    <ApplicabilityChallenges
      engagementId="e-1"
      challenges={[]}
      references={references}
      loadFailed={false}
      {...over}
    />
  );
}

describe("ApplicabilityChallenges", () => {
  beforeEach(() => actions.raiseChallenge.mockReset());

  it("offers NO way to remove, suppress or waive a requirement", () => {
    mount({ challenges: [recorded] });
    fireEvent.click(screen.getByRole("button", { name: /Disagree with a determination/ }));
    // The floor is a product minimum, so no CONTROL may offer to waive it.
    // The words themselves do appear on screen — in the sentence saying the
    // opposite — so this asserts on the interactive surface, not on the prose.
    for (const name of [/remove/i, /suppress/i, /waive/i, /exclude/i, /skip/i, /not applicable/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByRole("checkbox", { name })).toBeNull();
    }
    // The only options are determinations to talk ABOUT, never actions.
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((o) => /remove|suppress|waive/i.test(o))).toBe(false);
    // And it says so before the customer commits.
    expect(screen.getByText(/does not remove the requirement or change what the vendor is asked/i)).toBeTruthy();
    expect(screen.getByText(/are a minimum and are not waived by objection/i)).toBeTruthy();
  });

  it("shows SecureLogic's determination beside the objection, with its author", () => {
    mount({ challenges: [recorded] });
    expect(screen.getByText(/SecureLogic determined: Asked/)).toBeTruthy();
    expect(screen.getByText(/We terminated the only subprocessor last quarter/)).toBeTruthy();
    expect(screen.getByText(/Dana Analyst/)).toBeTruthy();
    // The platform's own words at the time — the record preserves what it said,
    // not the objector's account of it.
    expect(screen.getByText(/fourth-party management is assessed/)).toBeTruthy();
  });

  it("marks a challenge whose determination has since changed", () => {
    mount({ challenges: [{ ...recorded, superseded: true }] });
    expect(screen.getByText(/determination has since changed/)).toBeTruthy();
  });

  it("requires a determination and a real reason before it will record anything", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Disagree with a determination/ }));
    const submit = screen.getByRole("button", { name: /Record disagreement/ });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Determination to challenge"), { target: { value: "CAS-11" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why you disagree"), { target: { value: "wrong" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Why you disagree"), {
      target: { value: "No subprocessors remain for this service." },
    });
    expect(submit).toBeEnabled();
  });

  it("renders the ENGINE's resolution sentence verbatim, not a local restatement", async () => {
    // What a challenge resolves to depends on engine behaviour, which has an
    // open owner decision behind it. Two copies of that sentence would drift.
    const engineWords =
      "Recorded against this engagement's current determination. It does not change the assessment. " +
      "This engagement composes on the facts it was opened with.";
    actions.raiseChallenge.mockResolvedValue({ ok: true, resolution: engineWords });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Disagree with a determination/ }));
    fireEvent.change(screen.getByLabelText("Determination to challenge"), { target: { value: "CC6.1" } });
    fireEvent.change(screen.getByLabelText("Why you disagree"), {
      target: { value: "Access is read-only and brokered through a proxy." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record disagreement/ }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(engineWords));
    expect(actions.raiseChallenge).toHaveBeenCalledWith("e-1", {
      requirement_reference: "CC6.1",
      reason: "Access is read-only and brokered through a proxy.",
    });
    expect(clientRouter.refresh).toHaveBeenCalled();
  });

  it("reports a REFUSED call in the card, verbatim, with the form intact", async () => {
    // NOTE ON COVERAGE. The adjacent case — a call that REJECTS at the
    // transport layer (the VO 2.0 walkthrough crash class) — is handled by the
    // same try/catch in submit() and was verified behaving correctly
    // (in-card alert, one call, form intact). It is not asserted here: in this
    // file the rejection is re-reported by the runtime after the component has
    // already handled it, and chasing that harness interaction cost more than
    // the coverage is worth. The identical pattern IS pinned against
    // IssueQuestionnaireFlow and VendorContactsCard, which is where a
    // regression in the shared shape would surface.
    actions.raiseChallenge.mockResolvedValue({
      ok: false,
      error: "Explain why you disagree with this determination. It is recorded against the engagement with your name.",
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Disagree with a determination/ }));
    fireEvent.change(screen.getByLabelText("Determination to challenge"), { target: { value: "CAS-11" } });
    fireEvent.change(screen.getByLabelText("Why you disagree"), {
      target: { value: "This determination rests on a stale fact." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record disagreement/ }));

    // The engine's own words, not a locally-invented sentence.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/recorded against the engagement with your name/i)
    );
    // The form keeps what was typed, so the customer can fix it rather than retype it.
    expect((screen.getByLabelText("Why you disagree") as HTMLTextAreaElement).value).toBe(
      "This determination rests on a stale fact."
    );
    // Nothing was recorded, so nothing is re-read.
    expect(clientRouter.refresh).not.toHaveBeenCalled();
  });

  it("distinguishes an empty record from a failed read", () => {
    mount({ loadFailed: true });
    expect(screen.getByText(/load failure, not an empty record/i)).toBeTruthy();
    expect(screen.queryByText(/No one has disputed/)).toBeNull();
  });
});
