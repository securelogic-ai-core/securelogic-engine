"use client";

/**
 * /portal/team — the supplier's own view of who is working on this assessment
 * (VA-P1).
 *
 * This page exists because the alternative was forwarding the link. A vendor
 * whose security lead answers the security controls and whose counsel answers
 * the privacy ones previously had exactly one credential between them, which
 * meant one mailbox holding a key to a weeks-long session, every answer
 * attributed to the same anonymous token, and no way to remove one person
 * without removing everybody.
 *
 * Only the main contact can change the team. Everyone else can see it — knowing
 * who else is on the questionnaire is not a privilege, it is the point.
 *
 * Nothing here can name another supplier, another engagement or another tenant:
 * the engine takes all three from the session row, so the page has no field in
 * which to express them.
 */

import { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  portalFetch,
  type PortalParticipant,
  type PortalParticipants,
} from "../portalApi";

const ROLE_LABEL: Record<string, string> = {
  coordinator: "Main contact",
  contributor: "Contributor",
};

const box: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 16,
  background: "#fff",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  marginTop: 4,
};

function statusText(p: PortalParticipant): string {
  if (p.status === "revoked") return "Access removed";
  if (p.status === "active") return "Has opened the questionnaire";
  return "Invited — has not opened it yet";
}

export default function PortalTeamPage(): JSX.Element {
  const [data, setData] = useState<PortalParticipants | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [pickContact, setPickContact] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [freshLink, setFreshLink] = useState<{ token: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await portalFetch<PortalParticipants>("/participants");
    if (res.status === 401) {
      setError("Your session has ended. Open your invitation link again.");
      setData(null);
    } else if (!res.ok || !res.body) {
      setError(errorMessage(res, "The team list could not be loaded."));
    } else {
      setData(res.body);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(): Promise<void> {
    setBusy(true);
    setError(null);
    const payload = pickContact
      ? { contact_id: pickContact }
      : { full_name: fullName.trim(), email: email.trim(), title: title.trim() || undefined };
    const res = await portalFetch<{ invite_token: string }>("/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      setError(errorMessage(res, "That person could not be added."));
    } else {
      // Shown once. Only a hash is stored, so it can never be displayed again —
      // if email delivery is off, this is the only copy.
      setFreshLink({ token: res.body.invite_token, name: pickContact ? "them" : fullName.trim() });
      setShowAdd(false);
      setPickContact("");
      setFullName("");
      setEmail("");
      setTitle("");
      await load();
    }
    setBusy(false);
  }

  async function revoke(p: PortalParticipant): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await portalFetch(`/participants/${p.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) setError(errorMessage(res, "That person could not be removed."));
    else await load();
    setBusy(false);
  }

  const canManage = data?.you.can_manage_team === true;

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>Your team</h1>
      <p style={{ color: "#475569", fontSize: 13, margin: "0 0 16px" }}>
        Everyone here works on the <strong>same</strong> questionnaire — answers and attachments are
        shared, not duplicated per person.
        {canManage
          ? " As the main contact you can bring colleagues in and remove them."
          : " Only the main contact can add or remove people."}
      </p>

      {error && (
        <p
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 13,
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </p>
      )}

      {freshLink && (
        <div style={{ ...box, borderColor: "#bfdbfe", background: "#eff6ff", marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "#1e3a8a" }}>
            Invitation link for {freshLink.name}. <strong>Shown once</strong> — copy it now and send
            it to them if they do not receive an email.
          </p>
          <code style={{ display: "block", wordBreak: "break-all", fontSize: 11, color: "#0f172a" }}>
            {typeof window !== "undefined" ? window.location.origin : ""}/portal/accept/
            {freshLink.token}
          </code>
        </div>
      )}

      {loading && <p style={{ color: "#64748b", fontSize: 13 }}>Loading…</p>}

      {data && (
        <div style={box}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.participants.map((p, i) => (
              <li
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: i === 0 ? "none" : "1px solid #e2e8f0",
                  opacity: p.status === "revoked" ? 0.55 : 1,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#0f172a" }}>
                    {p.full_name}
                    {p.is_you && (
                      <span style={{ color: "#2563eb", fontSize: 12, marginLeft: 8 }}>you</span>
                    )}
                    <span style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}>
                      {ROLE_LABEL[p.participant_role] ?? p.participant_role}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {p.email}
                    {p.title ? ` · ${p.title}` : ""} · {statusText(p)}
                  </div>
                </div>
                {canManage && !p.is_you && p.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(p)}
                    style={{
                      background: "#fff",
                      border: "1px solid #fecaca",
                      color: "#b91c1c",
                      borderRadius: 6,
                      padding: "4px 10px",
                      fontSize: 12,
                      cursor: busy ? "default" : "pointer",
                    }}
                    title="Removes their access. Everything they already answered stays."
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canManage && !showAdd && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              disabled={busy}
              style={{
                marginTop: 12,
                background: "#1d4ed8",
                border: "none",
                color: "#fff",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                cursor: busy ? "default" : "pointer",
              }}
            >
              Invite a colleague
            </button>
          )}

          {canManage && showAdd && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <p style={{ fontSize: 12, color: "#475569", margin: "0 0 8px" }}>
                They will get their own link to this same questionnaire.
              </p>
              <label style={{ display: "block", fontSize: 12, color: "#475569" }}>
                Their name
                <input
                  style={input}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label style={{ display: "block", fontSize: 12, color: "#475569", marginTop: 8 }}>
                Their work email
                <input
                  style={input}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label style={{ display: "block", fontSize: 12, color: "#475569", marginTop: 8 }}>
                Their role (optional)
                <input
                  style={input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  disabled={busy || !fullName.trim() || !email.trim()}
                  onClick={() => void invite()}
                  style={{
                    background: fullName.trim() && email.trim() ? "#1d4ed8" : "#cbd5e1",
                    border: "none",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 13,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  {busy ? "Sending…" : "Send invitation"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  disabled={busy}
                  style={{
                    background: "#fff",
                    border: "1px solid #cbd5e1",
                    color: "#334155",
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
