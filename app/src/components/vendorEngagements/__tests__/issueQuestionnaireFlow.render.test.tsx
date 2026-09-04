/**
 * IssueQuestionnaireFlow — the customer sends the questionnaire from
 * SecureLogic (goal §A/§B), from the click.
 *
 * Pins:
 *   - the recipient is picked from the vendor's contact directory, with the
 *     primary/security contact suggested and name · title · email · role shown;
 *   - "Add contact" during issuance writes to the same directory and selects
 *     the new person;
 *   - the invitation step prefills the professional default, addressed by
 *     first name, with an optional due date, and sends contact id + message;
 *   - the sent step tells the truth about delivery and keeps the secure link
 *     as a collapsed recovery path;
 *   - a failed send is reported as issued-but-not-delivered with the link open;
 *   - a REJECTED action call (the walkthrough crash class) is reported in the
 *     card with the form intact, never thrown into the route;
 *   - reissue mode calls the reissue action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { clientRouter } from "@/test/harness";

const engagementActions = vi.hoisted(() => ({
  issueEngagement: vi.fn(),
  reissueInvite: vi.fn(),
}));
const contactActions = vi.hoisted(() => ({ addVendorContact: vi.fn() }));
vi.mock("@/app/actions/vendorEngagements", () => engagementActions);
vi.mock("@/app/actions/vendorContacts", () => contactActions);

import IssueQuestionnaireFlow, { TRANSPORT_FAILURE } from "../IssueQuestionnaireFlow";
import type { VendorContact } from "@/lib/api";

const jane: VendorContact = {
  id: "c-jane", vendor_id: "v-1", full_name: "Jane Okafor", email: "jane.okafor@stripe.example", title: "Security Lead",
  phone: null, contact_role: "security", is_primary_contact: true, status: "active", notes: null,
  created_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
};
const raj: VendorContact = { ...jane, id: "c-raj", full_name: "Raj Mehta", email: "raj.mehta@stripe.example", title: null, contact_role: "privacy", is_primary_contact: false };
const inactive: VendorContact = { ...jane, id: "c-old", full_name: "Old Person", email: "old@stripe.example", status: "inactive", is_primary_contact: false };

const sent = {
  ok: true as const, inviteId: "inv-1", inviteToken: "tok".padEnd(64, "0"), expiresAt: "2026-10-04T00:00:00Z",
  contactId: "c-jane", contactEmail: "jane.okafor@stripe.example", dueDate: null, emailDelivery: "sent" as const, emailDeliveryDetail: null,
};

function mount(over: Partial<React.ComponentProps<typeof IssueQuestionnaireFlow>> = {}) {
  const onCancel = vi.fn();
  render(
    <IssueQuestionnaireFlow
      engagementId="e-1"
      vendorId="v-1"
      vendorName="Stripe"
      organizationName="Walkthrough Org"
      contacts={[jane, raj, inactive]}
      contactsLoadFailed={false}
      previousRecipientIds={[]}
      mode="issue"
      onCancel={onCancel}
      {...over}
    />
  );
  return { onCancel };
}

beforeEach(() => {
  engagementActions.issueEngagement.mockReset();
  engagementActions.reissueInvite.mockReset();
  contactActions.addVendorContact.mockReset();
});

describe("recipient selection from the contact directory", () => {
  it("lists active contacts with name, title, email and role; suggests the primary; hides inactive ones", () => {
    mount();
    expect(screen.getByText("Jane Okafor")).toBeTruthy();
    expect(screen.getByText("· Security Lead")).toBeTruthy();
    expect(screen.getByText("jane.okafor@stripe.example")).toBeTruthy();
    expect(screen.getByText("Raj Mehta")).toBeTruthy();
    expect(screen.queryByText("Old Person")).toBeNull();
    const janeRadio = screen.getByLabelText("Jane Okafor <jane.okafor@stripe.example>") as HTMLInputElement;
    expect(janeRadio.checked).toBe(true);
    expect(screen.getByText(/· suggested/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Jane Okafor →" })).toBeTruthy();
    // No free-text email field is asked for: the directory is the source.
    expect(screen.queryByPlaceholderText("security@vendor.example")).toBeNull();
  });

  it("marks the previous questionnaire recipient and suggests them over the primary", () => {
    mount({ previousRecipientIds: ["c-raj"] });
    expect((screen.getByLabelText("Raj Mehta <raj.mehta@stripe.example>") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/previous questionnaire recipient/)).toBeTruthy();
  });

  it("adds a contact during issuance through the directory action and selects the new person", async () => {
    contactActions.addVendorContact.mockResolvedValue({
      ok: true,
      contact: { ...raj, id: "c-new", full_name: "Priya Raman", email: "priya@stripe.example", title: "Privacy Officer" },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add a contact who is not listed" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Priya Raman" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "priya@stripe.example" } });
    fireEvent.change(screen.getByPlaceholderText("Title (optional)"), { target: { value: "Privacy Officer" } });
    fireEvent.change(screen.getByLabelText("Contact role"), { target: { value: "privacy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(screen.getByText("Priya Raman")).toBeTruthy());
    expect(contactActions.addVendorContact).toHaveBeenCalledWith("v-1", {
      full_name: "Priya Raman", email: "priya@stripe.example", title: "Privacy Officer", contact_role: "privacy", is_primary_contact: false,
    });
    expect((screen.getByLabelText("Priya Raman <priya@stripe.example>") as HTMLInputElement).checked).toBe(true);
    expect(clientRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("a rejected add-contact call is reported in the card with the form intact", async () => {
    contactActions.addVendorContact.mockRejectedValue(new TypeError("Load failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add a contact who is not listed" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Priya Raman" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "priya@stripe.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(TRANSPORT_FAILURE));
    expect((screen.getByPlaceholderText("Full name") as HTMLInputElement).value).toBe("Priya Raman");
    expect(clientRouter.refresh).not.toHaveBeenCalled();
  });

  it("opens the add form immediately when the directory is empty", () => {
    mount({ contacts: [] });
    expect(screen.getByPlaceholderText("Full name")).toBeTruthy();
    expect(screen.getByText("No active contacts yet for Stripe.")).toBeTruthy();
  });
});

describe("compose and send", () => {
  it("prefills the professional default addressed by first name, accepts a due date, and sends contact id + message", async () => {
    engagementActions.issueEngagement.mockResolvedValue({ ...sent, dueDate: "2026-09-25" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jane Okafor →" }));
    const textarea = screen.getByLabelText("Invitation message") as HTMLTextAreaElement;
    expect(textarea.value.startsWith("Hello Jane,")).toBe(true);
    expect(textarea.value).toContain("Walkthrough Org assesses the security and governance posture of its vendors");
    expect(textarea.value).toContain("Stripe has been selected for an assessment");
    fireEvent.change(screen.getByLabelText("Response due (optional)"), { target: { value: "2026-09-25" } });
    expect((screen.getByLabelText("Invitation message") as HTMLTextAreaElement).value).toContain("September 25, 2026");
    fireEvent.change(screen.getByLabelText("Invitation message"), { target: { value: "Hello Jane,\n\nCustom text." } });
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Invitation sent from SecureLogic."));
    expect(engagementActions.issueEngagement).toHaveBeenCalledWith("e-1", {
      contactId: "c-jane", message: "Hello Jane,\n\nCustom text.", dueDate: "2026-09-25",
    });
    expect(screen.getByText(/jane.okafor@stripe.example/)).toBeTruthy();
    expect(screen.getByText(/response due 2026-09-25/)).toBeTruthy();
    // the link is the collapsed recovery path, not the headline
    const details = screen.getByText(/Copy the secure link/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByTestId("secure-link").textContent).toContain(`/portal/accept/${sent.inviteToken}`);
    expect(clientRouter.refresh).toHaveBeenCalled();
  });

  it("a failed send is reported as issued-but-not-delivered, with the recovery link opened", async () => {
    engagementActions.issueEngagement.mockResolvedValue({ ...sent, emailDelivery: "failed", emailDeliveryDetail: "failed: provider 500" });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jane Okafor →" }));
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("could not be delivered"));
    expect(screen.getByRole("status").textContent).toContain("failed: provider 500");
    const details = screen.getByText(/Copy the secure link/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });

  it("a refused send shows the engine's words and keeps the composed invitation", async () => {
    engagementActions.issueEngagement.mockResolvedValue({ ok: false, error: "Compose the assessment first — an empty questionnaire cannot be sent." });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jane Okafor →" }));
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Compose the assessment first"));
    expect(screen.getByLabelText("Invitation message")).toBeTruthy();
  });

  it("a REJECTED send call is reported in the card with the invitation intact — never thrown into the route", async () => {
    engagementActions.issueEngagement.mockRejectedValue(new TypeError("Load failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jane Okafor →" }));
    fireEvent.change(screen.getByLabelText("Invitation message"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(TRANSPORT_FAILURE));
    expect((screen.getByLabelText("Invitation message") as HTMLTextAreaElement).value).toBe("Keep me");
    expect(clientRouter.refresh).not.toHaveBeenCalled();
    // and a retry goes out again
    engagementActions.issueEngagement.mockResolvedValue(sent);
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(engagementActions.issueEngagement).toHaveBeenCalledTimes(2);
  });

  it("reissue mode sends a new invitation through the reissue action and says the old link stops working", async () => {
    engagementActions.reissueInvite.mockResolvedValue(sent);
    mount({ mode: "reissue" });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jane Okafor →" }));
    expect(screen.getByText(/replaces the current link/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send new invitation" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(engagementActions.reissueInvite).toHaveBeenCalledTimes(1);
    expect(engagementActions.issueEngagement).not.toHaveBeenCalled();
  });
});
