"use client";

/**
 * IssueQuestionnaireFlow — send the questionnaire from SecureLogic (goal §A/§B).
 *
 * Three steps, in the customer's order:
 *   1. Recipient — chosen from the vendor's canonical CONTACT directory (name,
 *      title, email, role, primary, previously invited). "Add contact" is
 *      right here for the person who is not in the directory yet; it writes
 *      to the same directory the vendor page shows — there is no second
 *      contact model.
 *   2. Invitation — a professional default message the customer can edit, and
 *      an optional due date. The secure link is inserted by SecureLogic at
 *      send time; the customer never handles it.
 *   3. Sent — who it went to, whether it left the building (the engine's own
 *      delivery state, never implied), and the "copy secure link" RECOVERY
 *      path, collapsed, for the case where email did not.
 *
 * Every transition awaits a server action inside try/catch: a call that
 * rejects before reaching the app (the walkthrough crash class) is reported
 * in this card with the form intact, never thrown into the route.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VendorContact, VendorContactRole, VendorInviteDeliveryState } from "@/lib/api";
import { VENDOR_CONTACT_ROLES } from "@/lib/api";
import { addVendorContact } from "@/app/actions/vendorContacts";
import { issueEngagement, reissueInvite, type IssueEngagementResult } from "@/app/actions/vendorEngagements";
import { defaultInvitationMessage, portalInviteUrl } from "@/lib/vendorEngagements";

export const TRANSPORT_FAILURE =
  "The request did not reach SecureLogic, so nothing was sent. Check your connection and try again.";

const ROLE_LABELS: Record<VendorContactRole, string> = {
  security: "Security",
  privacy: "Privacy",
  legal: "Legal",
  executive: "Executive",
  commercial: "Commercial",
  other: "Other",
};

export const DELIVERY_COPY: Record<VendorInviteDeliveryState, { tone: "ok" | "warn" | "muted"; text: string }> = {
  sent: { tone: "ok", text: "Invitation sent from SecureLogic." },
  failed: { tone: "warn", text: "The questionnaire is issued, but the invitation email could not be delivered." },
  suppressed: {
    tone: "warn",
    text: "The questionnaire is issued, but this address is on the suppression list, so no email was sent.",
  },
  disabled: {
    tone: "muted",
    text: "Email sending is not enabled on this environment. The questionnaire is issued; share the secure link below.",
  },
  not_attempted: { tone: "muted", text: "No email was sent. Share the secure link below." },
};

type Props = {
  engagementId: string;
  vendorId: string;
  vendorName: string;
  organizationName: string;
  contacts: VendorContact[];
  contactsLoadFailed: boolean;
  /** Contact ids that received an earlier questionnaire for this vendor. */
  previousRecipientIds: string[];
  mode: "issue" | "reissue";
  onCancel: () => void;
  onSent?: (r: Extract<IssueEngagementResult, { ok: true }>) => void;
};

type Step = "recipient" | "compose" | "sent";

export default function IssueQuestionnaireFlow({
  engagementId,
  vendorId,
  vendorName,
  organizationName,
  contacts: initialContacts,
  contactsLoadFailed,
  previousRecipientIds,
  mode,
  onCancel,
  onSent,
}: Props): JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("recipient");
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<VendorContact[]>(initialContacts);
  const active = contacts.filter((c) => c.status === "active");
  const previous = new Set(previousRecipientIds);

  // Prefer: the last questionnaire recipient, then the primary contact, then a security contact.
  const suggested =
    active.find((c) => previous.has(c.id)) ??
    active.find((c) => c.is_primary_contact) ??
    active.find((c) => c.contact_role === "security") ??
    null;
  const [selectedId, setSelectedId] = useState<string | null>(suggested?.id ?? null);
  const selected = active.find((c) => c.id === selectedId) ?? null;

  // Add-contact form (the same directory the vendor page manages).
  const [adding, setAdding] = useState(active.length === 0 && !contactsLoadFailed);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<VendorContactRole>("security");

  // Composition.
  const [message, setMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [result, setResult] = useState<Extract<IssueEngagementResult, { ok: true }> | null>(null);
  const [copied, setCopied] = useState(false);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function addContact(): void {
    setError(null);
    start(async () => {
      let r: Awaited<ReturnType<typeof addVendorContact>>;
      try {
        r = await addVendorContact(vendorId, {
          full_name: fullName.trim(),
          email: email.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
          contact_role: role,
          is_primary_contact: active.length === 0,
        });
      } catch {
        setError(TRANSPORT_FAILURE);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.contact) {
        setContacts((cur) => [...cur, r.contact!]);
        setSelectedId(r.contact.id);
      }
      setAdding(false);
      setFullName("");
      setEmail("");
      setTitle("");
      router.refresh();
    });
  }

  function proceedToCompose(): void {
    if (!selected) return;
    setError(null);
    setMessage(
      defaultInvitationMessage({
        contactName: selected.full_name,
        organizationName,
        vendorName,
        dueDate: dueDate || null,
      })
    );
    setStep("compose");
  }

  function send(): void {
    if (!selected) return;
    setError(null);
    start(async () => {
      let r: IssueEngagementResult;
      try {
        const input = {
          contactId: selected.id,
          message: message.trim(),
          ...(dueDate ? { dueDate } : {}),
        };
        r = mode === "issue" ? await issueEngagement(engagementId, input) : await reissueInvite(engagementId, input);
      } catch {
        setError(TRANSPORT_FAILURE);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r);
      setCopied(false);
      setStep("sent");
      onSent?.(r);
      router.refresh();
    });
  }

  const stepLabel = (n: number, label: string, current: boolean, done: boolean) => (
    <span style={{ fontSize: 12, color: current ? "#93c5fd" : done ? "#86efac" : "#6b7280" }}>
      {n}. {label}
    </span>
  );

  return (
    <div style={box()} aria-label={mode === "issue" ? "Issue questionnaire" : "Resend invitation"}>
      <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
        {stepLabel(1, "Recipient", step === "recipient", step !== "recipient")}
        {stepLabel(2, "Invitation", step === "compose", step === "sent")}
        {stepLabel(3, "Sent", step === "sent", false)}
      </div>

      {step === "recipient" && (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={hint()}>
            Choose who at {vendorName} should receive the questionnaire. The invitation is sent from SecureLogic
            with a secure link; the recipient does not need an account.
          </p>
          {contactsLoadFailed && (
            <p style={{ ...hint(), color: "#fde68a" }}>
              The contact directory could not be loaded. Reload the page, or add the contact below.
            </p>
          )}
          {active.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }} aria-label="Vendor contacts">
              {active.map((c) => {
                const isSelected = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <label
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: isSelected ? "1px solid #2563eb" : "1px solid #334155",
                        background: isSelected ? "rgba(37,99,235,0.12)" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="recipient"
                        value={c.id}
                        checked={isSelected}
                        onChange={() => setSelectedId(c.id)}
                        disabled={pending}
                        aria-label={`${c.full_name} <${c.email}>`}
                      />
                      <span style={{ display: "grid", gap: 2 }}>
                        <span style={{ fontSize: 13, color: "#e5e7eb" }}>
                          {c.full_name}
                          {c.title && <span style={{ color: "#9ca3af" }}> · {c.title}</span>}
                        </span>
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>{c.email}</span>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>
                          {ROLE_LABELS[c.contact_role]}
                          {c.is_primary_contact && <span style={{ color: "#86efac" }}> · primary</span>}
                          {previous.has(c.id) && <span style={{ color: "#93c5fd" }}> · previous questionnaire recipient</span>}
                          {suggested?.id === c.id && <span style={{ color: "#93c5fd" }}> · suggested</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {active.length === 0 && <p style={hint()}>No active contacts yet for {vendorName}.</p>}

          {!adding ? (
            <button type="button" onClick={() => setAdding(true)} disabled={pending} style={linkButton()}>
              + Add a contact who is not listed
            </button>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 10, border: "1px dashed #334155", borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Add to {vendorName}&apos;s contact directory</span>
              <input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={pending} style={input()} />
              <input placeholder="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} style={input()} />
              <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} style={input()} />
              <select value={role} onChange={(e) => setRole(e.target.value as VendorContactRole)} disabled={pending} style={input()} aria-label="Contact role">
                {VENDOR_CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={addContact} disabled={pending || !fullName.trim() || !emailValid} style={primary()}>
                  {pending ? "Saving…" : "Add contact"}
                </button>
                {active.length > 0 && (
                  <button type="button" onClick={() => setAdding(false)} disabled={pending} style={secondary()}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={proceedToCompose} disabled={pending || !selected} style={primary()}>
              Continue with {selected ? selected.full_name : "a recipient"} →
            </button>
            <button type="button" onClick={onCancel} disabled={pending} style={secondary()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "compose" && selected && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: "#e5e7eb" }}>
            To: {selected.full_name}
            {selected.title && <span style={{ color: "#9ca3af" }}> · {selected.title}</span>}
            <span style={{ color: "#9ca3af" }}> · {selected.email}</span>{" "}
            <button type="button" onClick={() => setStep("recipient")} disabled={pending} style={linkButton()}>
              change
            </button>
          </div>
          <label style={lbl()}>
            Response due (optional)
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                const next = e.target.value;
                setDueDate(next);
                // Keep the default message in step with the date unless the customer has edited it.
                const prior = defaultInvitationMessage({ contactName: selected.full_name, organizationName, vendorName, dueDate: dueDate || null });
                if (message === prior) {
                  setMessage(defaultInvitationMessage({ contactName: selected.full_name, organizationName, vendorName, dueDate: next || null }));
                }
              }}
              disabled={pending}
              style={input()}
            />
          </label>
          <label style={lbl()}>
            Invitation message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              maxLength={4000}
              disabled={pending}
              style={{ ...input(), fontFamily: "inherit", lineHeight: 1.45 }}
            />
          </label>
          <p style={hint()}>
            SecureLogic inserts the secure questionnaire link and the expiry automatically, and sends on behalf of{" "}
            {organizationName}.
            {mode === "reissue" && " Sending a new invitation replaces the current link; the previous one stops working."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={send} disabled={pending || message.trim().length === 0} style={primary()}>
              {pending ? "Sending…" : mode === "issue" ? "Send questionnaire" : "Send new invitation"}
            </button>
            <button type="button" onClick={onCancel} disabled={pending} style={secondary()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "sent" && result && (
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              fontSize: 13,
              color: DELIVERY_COPY[result.emailDelivery].tone === "ok" ? "#86efac" : DELIVERY_COPY[result.emailDelivery].tone === "warn" ? "#fde68a" : "#9ca3af",
            }}
            role="status"
          >
            {DELIVERY_COPY[result.emailDelivery].text}
            {result.emailDeliveryDetail && <span style={{ color: "#9ca3af" }}> ({result.emailDeliveryDetail})</span>}
          </div>
          <div style={{ fontSize: 13, color: "#e5e7eb" }}>
            {selected?.full_name ?? result.contactEmail} · {result.contactEmail}
            {result.dueDate && <span style={{ color: "#9ca3af" }}> · response due {result.dueDate}</span>}
            <span style={{ color: "#9ca3af" }}> · link expires {result.expiresAt.slice(0, 10)}</span>
          </div>
          <details open={result.emailDelivery !== "sent"} style={{ fontSize: 12, color: "#9ca3af" }}>
            <summary style={{ cursor: "pointer" }}>
              {result.emailDelivery === "sent" ? "Need the link yourself? Copy the secure link" : "Copy the secure link"} (shown once)
            </summary>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
              <code
                style={{ fontSize: 11, wordBreak: "break-all", flex: "1 1 320px", color: "#fde68a" }}
                data-testid="secure-link"
              >
                {portalInviteUrl(typeof window === "undefined" ? "" : window.location.origin, result.inviteToken)}
              </code>
              <button
                type="button"
                onClick={() => {
                  const url = portalInviteUrl(window.location.origin, result.inviteToken);
                  void navigator.clipboard?.writeText(url).then(() => setCopied(true));
                }}
                style={secondary()}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p style={{ margin: "6px 0 0" }}>
              Only a hash of this link is stored. Once you leave this page it cannot be recovered — resend a new
              invitation instead.
            </p>
          </details>
          <div>
            <button type="button" onClick={onCancel} style={secondary()}>
              Done
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function box(): React.CSSProperties {
  return { marginTop: 8, padding: 12, border: "1px solid #1e3a8a", borderRadius: 8, background: "rgba(30,58,138,0.10)" };
}
function hint(): React.CSSProperties {
  return { margin: 0, fontSize: 12, color: "#9ca3af" };
}
function lbl(): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" };
}
function input(): React.CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: "#111827",
    color: "#e5e7eb",
    fontSize: 13,
  };
}
function primary(): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #2563eb",
    background: "rgba(37,99,235,0.25)",
    color: "#bfdbfe",
    fontSize: 13,
    cursor: "pointer",
  };
}
function secondary(): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: "transparent",
    color: "#d1d5db",
    fontSize: 13,
    cursor: "pointer",
  };
}
function linkButton(): React.CSSProperties {
  return { background: "none", border: "none", color: "#93c5fd", fontSize: 12, cursor: "pointer", padding: 0, textAlign: "left" };
}
