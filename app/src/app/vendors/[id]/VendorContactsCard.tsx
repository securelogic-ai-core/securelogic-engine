"use client";

/**
 * VendorContactsCard — who we deal with at this supplier (VA-C1).
 *
 * Before this the answer lived in one place: an email address typed into the
 * issue form of a single engagement. This card is the supplier's directory —
 * the people a questionnaire can be addressed to, reused across engagements,
 * with the primary contact marked.
 *
 * Two product rules are visible rather than hidden:
 *   - a contact who has been sent a questionnaire cannot be deleted, only made
 *     inactive, because their name is attached to answers and evidence;
 *   - exactly one primary contact, and promoting a new one demotes the old.
 * Both are enforced by the engine; this component only reports what it says.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  VENDOR_CONTACT_ROLES,
  type VendorContact,
  type VendorContactRole,
} from "@/lib/api";
import { addVendorContact, editVendorContact, removeVendorContact } from "@/app/actions/vendorContacts";

const cardStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 10,
  padding: 16,
};

const ROLE_LABELS: Record<VendorContactRole, string> = {
  security: "Security",
  privacy: "Privacy",
  legal: "Legal",
  executive: "Executive",
  commercial: "Commercial",
  other: "Other",
};

/**
 * Shown when the request never got an answer (rejected fetch), as opposed to
 * an answer that refused (`{ ok: false }`). Exported so the render test pins
 * the exact sentence the customer sees.
 */
export const TRANSPORT_FAILURE =
  "The request did not reach SecureLogic, so nothing was saved. Check your connection and try again.";

function input(): React.CSSProperties {
  return {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: "#0b1220",
    color: "#e2e8f0",
    fontSize: 12,
  };
}

export function VendorContactsCard({
  vendorId,
  contacts,
  loadFailed,
}: {
  vendorId: string;
  contacts: VendorContact[];
  loadFailed: boolean;
}): JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<VendorContactRole>("security");
  const [primary, setPrimary] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string): void {
    setError(null);
    setNotice(null);
    start(async () => {
      // A server action call can REJECT before any request reaches the app —
      // the browser fails the POST at the transport layer (Safari reports it
      // as `TypeError: Load failed` on a stale keep-alive socket; any browser
      // does on a dropped connection or a deploy in flight). Under React 19
      // an unhandled rejection inside a transition is re-thrown during render
      // and, with no error boundary on this route, replaces the whole vendor
      // page with Next's "Application error: a client-side exception has
      // occurred" screen. That is the VO 2.0 walkthrough crash. The refusal
      // belongs in this card, with the form intact so the customer can retry
      // — nothing was recorded, and the message must say so.
      let result: { ok: boolean; error?: string };
      try {
        result = await fn();
      } catch {
        setError(TRANSPORT_FAILURE);
        return;
      }
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      setNotice(success);
      setOpen(false);
      setFullName("");
      setEmail("");
      setTitle("");
      setPrimary(false);
      router.refresh();
    });
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
          Contacts
        </h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          style={{
            fontSize: 11,
            color: "#93c5fd",
            background: "transparent",
            border: "1px solid #334155",
            borderRadius: 6,
            padding: "3px 10px",
            cursor: "pointer",
          }}
        >
          {open ? "Cancel" : "Add contact"}
        </button>
      </div>

      {/* "Nobody has been added yet" and "we could not load the directory" are
          different facts and must not render as the same sentence. */}
      {loadFailed ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>
          Contacts could not be loaded. This is a load failure, not an empty directory.
        </p>
      ) : contacts.length === 0 ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
          No contacts recorded. Adding the people you deal with here lets a questionnaire
          be addressed to a person instead of a typed-in address.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {contacts.map((c) => (
            <li
              key={c.id}
              style={{
                padding: "8px 0",
                borderTop: "1px solid #1e293b",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "baseline",
                opacity: c.status === "inactive" ? 0.55 : 1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#e2e8f0" }}>
                  {c.full_name}
                  {c.is_primary_contact && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: "#86efac" }}>PRIMARY</span>
                  )}
                  {c.status === "inactive" && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8" }}>INACTIVE</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", overflowWrap: "anywhere" }}>
                  {c.email}
                  {c.title ? ` · ${c.title}` : ""} · {ROLE_LABELS[c.contact_role] ?? c.contact_role}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {c.status === "active" && !c.is_primary_contact && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => editVendorContact(vendorId, c.id, { is_primary_contact: true }),
                        `${c.full_name} is now the primary contact.`
                      )
                    }
                    style={{ fontSize: 11, color: "#93c5fd", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Make primary
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        editVendorContact(vendorId, c.id, {
                          status: c.status === "active" ? "inactive" : "active",
                        }),
                      c.status === "active"
                        ? `${c.full_name} marked inactive. Their history is unchanged.`
                        : `${c.full_name} reactivated.`
                    )
                  }
                  style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
                >
                  {c.status === "active" ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => removeVendorContact(vendorId, c.id),
                      `${c.full_name} removed from the directory.`
                    )
                  }
                  style={{ fontSize: 11, color: "#fca5a5", background: "none", border: "none", cursor: "pointer" }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
            style={input()}
          />
          <input
            placeholder="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            style={input()}
          />
          <input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
            style={input()}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as VendorContactRole)}
            disabled={pending}
            style={input()}
          >
            {VENDOR_CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
              disabled={pending}
            />
            Primary contact for this supplier
          </label>
          <button
            type="button"
            disabled={pending || !fullName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
            onClick={() =>
              run(
                () =>
                  addVendorContact(vendorId, {
                    full_name: fullName.trim(),
                    email: email.trim(),
                    ...(title.trim() ? { title: title.trim() } : {}),
                    contact_role: role,
                    is_primary_contact: primary,
                  }),
                `${fullName.trim()} added to the directory.`
              )
            }
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "rgba(30,58,138,0.25)",
              color: "#93c5fd",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {pending ? "Saving…" : "Add contact"}
          </button>
        </div>
      )}

      {error && <p style={{ marginTop: 10, fontSize: 12, color: "#fca5a5" }}>{error}</p>}
      {notice && <p style={{ marginTop: 10, fontSize: 12, color: "#86efac" }}>{notice}</p>}
    </div>
  );
}
