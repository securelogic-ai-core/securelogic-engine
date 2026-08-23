"use client";

/**
 * ParticipantsSection — who at the supplier is working on this assessment (VA-P1).
 *
 * Before this, the answer was one email address on one invite and the customer
 * had no way to see whether anybody had actually opened the link, let alone who
 * else the supplier had pulled in. This section is the whole participation
 * state: the people, their role, whether their credential is live, whether they
 * have ever accepted, and who brought them in — including the ones the vendor's
 * own coordinator added, which the customer would otherwise never learn.
 *
 * Two rules are shown rather than hidden, because both surprise people:
 *   - only the COORDINATOR can submit, so an engagement whose coordinator was
 *     revoked cannot be submitted by anyone until a new one is named;
 *   - revoking ends access but keeps everything the person authored.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EngagementParticipant, EngagementProgress, VendorContact } from "@/lib/api";
import { addParticipant, revokeParticipant } from "@/app/actions/engagementParticipants";

const card: React.CSSProperties = {
  border: "1px solid #1f2937",
  borderRadius: 10,
  padding: 16,
  background: "#0b1220",
};

const ROLE_LABEL: Record<string, string> = {
  coordinator: "Main contact",
  contributor: "Contributor",
};

function statusChip(p: EngagementParticipant): { label: string; bg: string; fg: string } {
  if (p.status === "revoked") return { label: "Access revoked", bg: "rgba(127,29,29,0.25)", fg: "#fca5a5" };
  if (p.status === "active") return { label: "Working on it", bg: "rgba(6,78,59,0.35)", fg: "#6ee7b7" };
  return { label: "Invited — not opened", bg: "rgba(120,53,15,0.3)", fg: "#fcd34d" };
}

export default function ParticipantsSection({
  engagementId,
  participants,
  contacts,
  hasCoordinator,
  loadFailed,
  progress = null,
}: {
  engagementId: string;
  participants: EngagementParticipant[];
  contacts: VendorContact[];
  hasCoordinator: boolean;
  loadFailed: boolean;
  /** VA-D1. Null means the read failed or the engine predates it. */
  progress?: EngagementProgress | null;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ token: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState<"coordinator" | "contributor">("contributor");

  // Somebody already on the engagement is a RESEND, not a duplicate — the
  // engine reuses their row. Saying so up front avoids the customer thinking
  // they are about to create a second Jane.
  const existingContactIds = new Set(participants.filter((p) => p.status !== "revoked").map((p) => p.contact_id));
  const selectable = contacts.filter((c) => c.status === "active");

  function run(fn: () => Promise<{ ok: boolean; error?: string; inviteToken?: string }>, name: string): void {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "That didn't work.");
        return;
      }
      if (res.inviteToken) setInviteLink({ token: res.inviteToken, name });
      setAdding(false);
      setContactId("");
      router.refresh();
    });
  }

  if (loadFailed) {
    return (
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>People on this assessment</h2>
        <p style={{ color: "#fca5a5", fontSize: 13, margin: 0 }}>
          The participant list could not be loaded. This is a failed read, not an empty team —
          reload before concluding nobody has access.
        </p>
      </section>
    );
  }

  return (
    <section style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          People on this assessment{" "}
          <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 13 }}>({participants.length})</span>
        </h2>
        {selectable.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            disabled={pending}
            style={{
              background: "transparent",
              border: "1px solid #334155",
              color: "#93c5fd",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: pending ? "default" : "pointer",
            }}
          >
            {adding ? "Cancel" : "Add someone"}
          </button>
        )}
      </div>

      {!hasCoordinator && participants.length > 0 && (
        <p
          style={{
            margin: "10px 0 0",
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 12,
            background: "rgba(120,53,15,0.25)",
            color: "#fcd34d",
            border: "1px solid #b45309",
          }}
        >
          No main contact. Contributors can still answer, but <strong>nobody can submit</strong> this
          questionnaire until you name one.
        </p>
      )}

      {/* VA-D1 — the reviewer's question is "is the vendor still working on
          this?", not "how has the supplier divided the labour". Shape only. */}
      {progress && progress.total > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#9ca3af" }}>
          Vendor progress: <strong style={{ color: "#e5e7eb" }}>
            {progress.complete} of {progress.total}
          </strong>{" "}
          answered
          {progress.outstanding > 0 ? ` · ${progress.outstanding} still outstanding` : " · complete"}
          {progress.contributors.length > 1 && (
            <> · {progress.contributors.length} people contributed</>
          )}
        </p>
      )}

      {participants.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: "10px 0 0" }}>
          Nobody has been given access yet. Issue the questionnaire to a contact, or add someone here.
        </p>
      )}

      {adding && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #1f2937", borderRadius: 8 }}>
          <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Who, from this supplier&apos;s contacts
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={pending}
              style={{
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0b1220",
                color: "#e2e8f0",
                fontSize: 13,
              }}
            >
              <option value="">Choose a contact…</option>
              {selectable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} ({c.email})
                  {existingContactIds.has(c.id) ? " — already on this assessment, will re-send" : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "coordinator" | "contributor")}
              disabled={pending}
              style={{
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0b1220",
                color: "#e2e8f0",
                fontSize: 13,
              }}
            >
              <option value="contributor">Contributor — answers questions</option>
              <option value="coordinator">Main contact — can invite their team and submit</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !contactId}
            onClick={() => {
              const person = selectable.find((c) => c.id === contactId);
              run(
                () => addParticipant(engagementId, contactId, role),
                person?.full_name ?? "them"
              );
            }}
            style={{
              background: contactId ? "#1d4ed8" : "#1f2937",
              border: "none",
              color: "#e5e7eb",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 12,
              cursor: pending || !contactId ? "default" : "pointer",
            }}
          >
            {pending ? "Sending…" : "Send invitation"}
          </button>
        </div>
      )}

      {error && (
        <p style={{ color: "#fca5a5", fontSize: 12, margin: "10px 0 0" }}>{error}</p>
      )}

      {inviteLink && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #1e40af",
            borderRadius: 8,
            background: "rgba(30,58,138,0.2)",
          }}
        >
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#bfdbfe" }}>
            Invitation link for {inviteLink.name}. <strong>Shown once</strong> — we only keep a hash,
            so it cannot be displayed again. Copy it now if email delivery is off.
          </p>
          <code
            style={{
              display: "block",
              wordBreak: "break-all",
              fontSize: 11,
              color: "#e5e7eb",
              background: "#0b1220",
              padding: 8,
              borderRadius: 4,
            }}
          >
            {typeof window !== "undefined" ? `${window.location.origin}/portal/accept/` : "/portal/accept/"}
            {inviteLink.token}
          </code>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {participants.map((p) => {
          const chip = statusChip(p);
          return (
            <li
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderTop: "1px solid #1f2937",
                opacity: p.status === "revoked" ? 0.6 : 1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#e5e7eb" }}>
                  {p.full_name}
                  <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 12 }}>
                    {ROLE_LABEL[p.participant_role] ?? p.participant_role}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  {p.email}
                  {p.title ? ` · ${p.title}` : ""}
                  {/* Who brought them in. A teammate-added participant is a fact
                      the customer cannot see anywhere else. */}
                  {p.invited_by_participant_id ? " · added by the supplier" : ""}
                  {p.first_accepted_at
                    ? ` · first opened ${new Date(p.first_accepted_at).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span
                  style={{
                    padding: "1px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    background: chip.bg,
                    color: chip.fg,
                  }}
                >
                  {chip.label}
                </span>
                {p.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={pending}
                    // Re-sending is the same act as adding: the engine reuses
                    // their participation row and supersedes only THEIR link,
                    // so nobody else is disturbed and no second identity is
                    // created for the same person.
                    onClick={() =>
                      run(
                        () => addParticipant(engagementId, p.contact_id, p.participant_role),
                        p.full_name
                      )
                    }
                    style={{
                      background: "transparent",
                      border: "1px solid #334155",
                      color: "#93c5fd",
                      borderRadius: 6,
                      padding: "3px 8px",
                      fontSize: 11,
                      cursor: pending ? "default" : "pointer",
                    }}
                    title="Mints a new link for this person. Their previous link stops working; everyone else is unaffected."
                  >
                    Re-send link
                  </button>
                )}
                {p.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => revokeParticipant(engagementId, p.id), p.full_name)}
                    style={{
                      background: "transparent",
                      border: "1px solid #7f1d1d",
                      color: "#fca5a5",
                      borderRadius: 6,
                      padding: "3px 8px",
                      fontSize: 11,
                      cursor: pending ? "default" : "pointer",
                    }}
                    title="Ends their access immediately. Their answers, files and comments stay."
                  >
                    Revoke access
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {participants.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "#6b7280" }}>
          Revoking ends access immediately and kills any open session. Everything the person already
          answered, uploaded or commented stays, still attributed to them.
        </p>
      )}
    </section>
  );
}
