/**
 * EngagementActionPanel — the transitions the owner walkthrough passes through
 * survive a dropped request, and the invitation lifecycle is offered from the
 * panel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  resolveScope: vi.fn(),
  overrideInherent: vi.fn(),
  issueEngagement: vi.fn(),
  reissueInvite: vi.fn(),
  revokeInvite: vi.fn(),
  beginReview: vi.fn(),
  completeAnalysis: vi.fn(),
  recomputeRisk: vi.fn(),
  recordDecision: vi.fn(),
  startMonitoring: vi.fn(),
  promoteFindings: vi.fn(),
}));
vi.mock("@/app/actions/vendorEngagements", () => actions);
vi.mock("@/app/actions/vendorContacts", () => ({ addVendorContact: vi.fn() }));

import EngagementActionPanel, { TRANSPORT_FAILURE } from "../EngagementActionPanel";
import type { VendorContact, VendorEngagementInviteSummary } from "@/lib/api";

const jane: VendorContact = {
  id: "c-jane", vendor_id: "v-1", full_name: "Jane Okafor", email: "jane@stripe.example", title: null, phone: null,
  contact_role: "security", is_primary_contact: true, status: "active", notes: null,
  created_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
};

const inviteSent: VendorEngagementInviteSummary = {
  active: {
    id: "inv-1", contact_id: "c-jane", contact_email: "jane@stripe.example", contact_name: "Jane Okafor", message: "Hello",
    due_date: "2026-09-25", email_delivery_state: "sent", email_delivery_at: "2026-09-04T10:00:00Z", email_provider_message_id: "re_1",
    email_delivery_detail: null, created_at: "2026-09-04T10:00:00Z", expires_at: "2026-10-04T10:00:00Z", revoked_at: null,
    revocation_reason: null, first_exchanged_at: null, last_exchanged_at: null, exchange_count: 0,
  },
  latest: null,
  history_count: 1,
};
inviteSent.latest = inviteSent.active;

function mount(state: "draft" | "scoped" | "issued", invite: VendorEngagementInviteSummary | null = null) {
  render(
    <EngagementActionPanel
      engagementId="e-1"
      state={state}
      inherentRating="High"
      vendorId="v-1"
      vendorName="Stripe"
      organizationName="Walkthrough Org"
      contacts={[jane]}
      contactsLoadFailed={false}
      invite={invite}
    />
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("EngagementActionPanel", () => {
  it("a REJECTED compose call is reported in the panel, never thrown into the route", async () => {
    actions.resolveScope.mockRejectedValue(new TypeError("Load failed"));
    mount("draft");
    fireEvent.click(screen.getByRole("button", { name: "Compose assessment" }));
    await waitFor(() => expect(screen.getByText(TRANSPORT_FAILURE)).toBeTruthy());
    // and the panel is still usable
    actions.resolveScope.mockResolvedValue({ ok: true, scoped: 12, excluded: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Compose assessment" }));
    await waitFor(() => expect(screen.getByText(/Composed: 12 requirements selected, 4 not applicable or not required/)).toBeTruthy());
  });

  it("composing to nothing is reported honestly", async () => {
    actions.resolveScope.mockResolvedValue({ ok: true, scoped: 0, excluded: 20 });
    mount("draft");
    fireEvent.click(screen.getByRole("button", { name: "Compose assessment" }));
    await waitFor(() => expect(screen.getByText(/no formal questionnaire is required/)).toBeTruthy());
  });

  it("sending opens the contact-based flow instead of a typed email form", () => {
    mount("scoped");
    fireEvent.click(screen.getByRole("button", { name: "Send questionnaire to vendor" }));
    expect(screen.getByLabelText("Issue questionnaire")).toBeTruthy();
    expect(screen.getByText("Jane Okafor")).toBeTruthy();
    expect(screen.queryByPlaceholderText("security@vendor.example")).toBeNull();
  });

  it("an issued engagement shows the invitation's recipient and delivery state, with resend and revoke", async () => {
    mount("issued", inviteSent);
    const block = screen.getByLabelText("Invitation");
    expect(block.textContent).toContain("Jane Okafor");
    expect(block.textContent).toContain("jane@stripe.example");
    expect(block.textContent).toContain("Invitation sent from SecureLogic.");
    expect(block.textContent).toContain("response due 2026-09-25");
    expect(block.textContent).toContain("not opened yet");
    // Deterministic expiry: an ISO calendar date, never a locale-formatted one.
    // This client component is server-rendered too, and locale/timezone date
    // formatting that differs between the server and the browser is a React
    // hydration mismatch (#418) — seen on staging on the first issued engagement.
    expect(block.textContent).toContain("expires 2026-10-04");
    expect(block.textContent).not.toMatch(/10\/4\/2026|04\/10\/2026/);
    fireEvent.click(screen.getByRole("button", { name: "Resend or change recipient" }));
    expect(screen.getByLabelText("Resend invitation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    actions.revokeInvite.mockResolvedValue({ ok: true, sessionsRevoked: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke access" }).pop()!);
    await waitFor(() => expect(screen.getByText(/Access revoked \(1 open session ended\)/)).toBeTruthy());
    expect(actions.revokeInvite).toHaveBeenCalledWith("e-1", undefined);
  });

  it("a failed delivery is shown as a warning on the invitation, not as sent", () => {
    const failed: VendorEngagementInviteSummary = {
      ...inviteSent,
      active: { ...inviteSent.active!, email_delivery_state: "failed", email_delivery_detail: "failed: provider 500" },
    };
    failed.latest = failed.active;
    mount("issued", failed);
    expect(screen.getByLabelText("Invitation").textContent).toContain("could not be delivered");
    expect(screen.getByLabelText("Invitation").textContent).toContain("failed: provider 500");
  });
});
