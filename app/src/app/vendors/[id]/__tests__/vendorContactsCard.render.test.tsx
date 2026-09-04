/**
 * VendorContactsCard — the contact-add path, end to end from the click.
 *
 * Owner staging validation of Vendor Onboarding 2.0 (2026-09-04) hit a full-page
 * "Application error: a client-side exception has occurred" on Add contact. No
 * request ever reached the app: the browser failed the action POST at the
 * transport layer (Safari's `TypeError: Load failed`), the server-action call
 * REJECTED, and the card's transition let that rejection escape. Under React 19
 * an unhandled rejection inside a transition is re-thrown during render and,
 * with no error boundary on /vendors/[id], Next replaced the whole page.
 *
 * These tests pin the contract from the customer's side:
 *   - a rejected call is reported inside the card, the form stays open with its
 *     values, and nothing else on the page is touched;
 *   - a refused call (`{ ok: false }`) shows the engine's words;
 *   - a successful call shows the notice, closes the form and refreshes the
 *     route so the server-rendered directory is re-read.
 * The same rule covers the adjacent operations (make primary / deactivate /
 * delete), which share the transition helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { clientRouter } from "@/test/harness";

const actions = vi.hoisted(() => ({
  addVendorContact: vi.fn(),
  editVendorContact: vi.fn(),
  removeVendorContact: vi.fn(),
}));
vi.mock("@/app/actions/vendorContacts", () => actions);

import { VendorContactsCard, TRANSPORT_FAILURE } from "../VendorContactsCard";
import type { VendorContact } from "@/lib/api";

const existing: VendorContact = {
  id: "c-1", vendor_id: "v-1", full_name: "Dana Whitfield", email: "dana.whitfield@example-vendor.com",
  title: "Head of Security", phone: null, contact_role: "security", is_primary_contact: true,
  status: "active", notes: null, created_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
};

function fillAndSubmit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Priya Raman" } });
  fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "priya.raman@example-vendor.com" } });
  fireEvent.change(screen.getByPlaceholderText("Title (optional)"), { target: { value: "Privacy Officer" } });
  fireEvent.change(screen.getByDisplayValue("Security"), { target: { value: "privacy" } });
  fireEvent.click(screen.getByLabelText("Primary contact for this supplier"));
  // The toggle above the list and the submit inside the form share a label;
  // the submit is the last one rendered.
  const buttons = screen.getAllByRole("button", { name: "Add contact" });
  fireEvent.click(buttons[buttons.length - 1]!);
}

describe("VendorContactsCard — add contact", () => {
  beforeEach(() => {
    actions.addVendorContact.mockReset();
    actions.editVendorContact.mockReset();
    actions.removeVendorContact.mockReset();
  });

  it("sends the typed contact to the action and, on success, closes the form and refreshes the route", async () => {
    actions.addVendorContact.mockResolvedValue({ ok: true, contact: { ...existing, id: "c-2" } });
    render(<VendorContactsCard vendorId="v-1" contacts={[]} loadFailed={false} />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText("Priya Raman added to the directory.")).toBeTruthy());
    expect(actions.addVendorContact).toHaveBeenCalledWith("v-1", {
      full_name: "Priya Raman",
      email: "priya.raman@example-vendor.com",
      title: "Privacy Officer",
      contact_role: "privacy",
      is_primary_contact: true,
    });
    expect(screen.queryByPlaceholderText("Full name")).toBeNull();
    expect(clientRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports a REJECTED action call inside the card and keeps the form — never throws into the route", async () => {
    // What the browser hands back when the POST never reaches the app
    // (Safari: "Load failed"; Chromium: "Failed to fetch").
    actions.addVendorContact.mockRejectedValue(new TypeError("Load failed"));
    render(<VendorContactsCard vendorId="v-1" contacts={[]} loadFailed={false} />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText(TRANSPORT_FAILURE)).toBeTruthy());
    // The customer's work is intact for the retry, and the directory is untouched.
    expect((screen.getByPlaceholderText("Full name") as HTMLInputElement).value).toBe("Priya Raman");
    expect((screen.getByPlaceholderText("Email address") as HTMLInputElement).value).toBe("priya.raman@example-vendor.com");
    expect(screen.getByText(/No contacts recorded/)).toBeTruthy();
    expect(clientRouter.refresh).not.toHaveBeenCalled();
    // A retry goes out again — the first failure did not wedge the transition.
    actions.addVendorContact.mockResolvedValue({ ok: true });
    const buttons = screen.getAllByRole("button", { name: "Add contact" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getByText("Priya Raman added to the directory.")).toBeTruthy());
    expect(actions.addVendorContact).toHaveBeenCalledTimes(2);
  });

  it("shows the engine's refusal verbatim when the call answers { ok: false }", async () => {
    actions.addVendorContact.mockResolvedValue({ ok: false, error: "This supplier already has a contact with that email address." });
    render(<VendorContactsCard vendorId="v-1" contacts={[existing]} loadFailed={false} />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText("This supplier already has a contact with that email address.")).toBeTruthy());
    expect(screen.getByPlaceholderText("Full name")).toBeTruthy();
    expect(clientRouter.refresh).not.toHaveBeenCalled();
  });
});

describe("VendorContactsCard — adjacent operations share the rule", () => {
  beforeEach(() => {
    actions.editVendorContact.mockReset();
    actions.removeVendorContact.mockReset();
  });

  it("a rejected deactivate is reported in the card", async () => {
    actions.editVendorContact.mockRejectedValue(new TypeError("Load failed"));
    render(<VendorContactsCard vendorId="v-1" contacts={[existing]} loadFailed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.getByText(TRANSPORT_FAILURE)).toBeTruthy());
    expect(actions.editVendorContact).toHaveBeenCalledWith("v-1", "c-1", { status: "inactive" });
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
  });

  it("a rejected delete is reported in the card and the row stays", async () => {
    actions.removeVendorContact.mockRejectedValue(new TypeError("Load failed"));
    render(<VendorContactsCard vendorId="v-1" contacts={[existing]} loadFailed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByText(TRANSPORT_FAILURE)).toBeTruthy());
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
    expect(clientRouter.refresh).not.toHaveBeenCalled();
  });

  it("make primary succeeds through the same path and refreshes", async () => {
    actions.editVendorContact.mockResolvedValue({ ok: true });
    render(
      <VendorContactsCard vendorId="v-1" contacts={[{ ...existing, id: "c-3", full_name: "Marcus Oyelaran", email: "marcus@example-vendor.com", is_primary_contact: false }]} loadFailed={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
    await waitFor(() => expect(screen.getByText("Marcus Oyelaran is now the primary contact.")).toBeTruthy());
    expect(actions.editVendorContact).toHaveBeenCalledWith("v-1", "c-3", { is_primary_contact: true });
    expect(clientRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
