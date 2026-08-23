/**
 * ParticipantsSection — the customer's view of who is on the assessment (VA-P1).
 *
 * Three things must be visible rather than inferable, because each one is a
 * state a customer would otherwise get wrong:
 *
 *   - a FAILED read is not an empty team. Rendering "nobody has access" when
 *     the request errored tells the customer their supplier was never invited;
 *   - an engagement with no live coordinator cannot be submitted BY ANYONE, and
 *     the only fix is the customer naming a new one;
 *   - a participant the SUPPLIER added is a fact the customer cannot learn from
 *     any other surface.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ParticipantsSection from "../ParticipantsSection";
import type { EngagementParticipant, VendorContact } from "@/lib/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/engagementParticipants", () => ({
  addParticipant: vi.fn(),
  revokeParticipant: vi.fn(),
}));

function participant(over: Partial<EngagementParticipant> = {}): EngagementParticipant {
  return {
    id: "p-1",
    contact_id: "c-1",
    full_name: "Jane Coordinator",
    email: "jane@vendor.example",
    title: "CISO",
    contact_status: "active",
    participant_role: "coordinator",
    status: "active",
    invited_by_user_id: "u-1",
    invited_by_participant_id: null,
    first_accepted_at: "2026-08-01T00:00:00.000Z",
    last_accepted_at: "2026-08-02T00:00:00.000Z",
    revoked_at: null,
    revocation_reason: null,
    invite_id: "i-1",
    invite_expires_at: "2026-09-01T00:00:00.000Z",
    invite_exchange_count: 2,
    ...over,
  };
}

const contacts: VendorContact[] = [
  {
    id: "c-1",
    vendor_id: "v-1",
    full_name: "Jane Coordinator",
    email: "jane@vendor.example",
    title: "CISO",
    phone: null,
    contact_role: "security",
    is_primary_contact: true,
    status: "active",
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  },
];

describe("ParticipantsSection", () => {
  it("a failed read says so instead of showing an empty team", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[]}
        contacts={contacts}
        hasCoordinator={false}
        loadFailed
      />
    );
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    // Critically, it must NOT claim nobody has access.
    expect(screen.queryByText(/Nobody has been given access/i)).not.toBeInTheDocument();
  });

  it("an empty team reads as empty, not as broken", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[]}
        contacts={contacts}
        hasCoordinator={false}
        loadFailed={false}
      />
    );
    expect(screen.getByText(/Nobody has been given access/i)).toBeInTheDocument();
  });

  it("warns that NOBODY can submit when there is no live coordinator", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[participant({ participant_role: "contributor" })]}
        contacts={contacts}
        hasCoordinator={false}
        loadFailed={false}
      />
    );
    expect(screen.getByText(/nobody can submit/i)).toBeInTheDocument();
  });

  it("does not warn when a coordinator is in place", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[participant()]}
        contacts={contacts}
        hasCoordinator
        loadFailed={false}
      />
    );
    expect(screen.queryByText(/nobody can submit/i)).not.toBeInTheDocument();
  });

  it("shows who the supplier added themselves", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[
          participant(),
          participant({
            id: "p-2",
            contact_id: "c-2",
            full_name: "Robert Counsel",
            email: "robert@vendor.example",
            participant_role: "contributor",
            invited_by_user_id: null,
            invited_by_participant_id: "p-1",
          }),
        ]}
        contacts={contacts}
        hasCoordinator
        loadFailed={false}
      />
    );
    expect(screen.getByText(/added by the supplier/i)).toBeInTheDocument();
  });

  it("distinguishes invited-but-never-opened from actually working", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[
          participant({ status: "invited", first_accepted_at: null }),
          participant({ id: "p-2", contact_id: "c-2", full_name: "Robert", status: "active" }),
        ]}
        contacts={contacts}
        hasCoordinator
        loadFailed={false}
      />
    );
    expect(screen.getByText(/Invited — not opened/i)).toBeInTheDocument();
    expect(screen.getByText(/Working on it/i)).toBeInTheDocument();
  });

  it("a revoked participant is still listed, with no revoke button", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[
          participant({ status: "revoked", revoked_at: "2026-08-10T00:00:00.000Z" }),
        ]}
        contacts={contacts}
        hasCoordinator={false}
        loadFailed={false}
      />
    );
    // History is preserved and visible — the person does not disappear.
    expect(screen.getByText("Jane Coordinator")).toBeInTheDocument();
    expect(screen.getByText(/Access revoked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke access/i })).not.toBeInTheDocument();
  });

  it("says plainly that revoking keeps the work", () => {
    render(
      <ParticipantsSection
        engagementId="e-1"
        participants={[participant()]}
        contacts={contacts}
        hasCoordinator
        loadFailed={false}
      />
    );
    expect(screen.getByText(/Everything the person already answered/i)).toBeInTheDocument();
  });
});
