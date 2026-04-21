"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamMember, PendingInvite } from "@/lib/api";
import InviteModal from "./InviteModal";
import { revokeInvite, removeMember, updateMemberRole, unlockMember } from "./actions";

interface Props {
  members: TeamMember[];
  pendingInvites: PendingInvite[];
  seatUsage: { used: number; max: number };
  currentUserId: string;
  currentUserRole: string;
  isAdmin: boolean;
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    admin:   { bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
    analyst: { bg: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
    viewer:  { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  };
  const s = styles[role] ?? styles.viewer!;
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        color: s.color,
        fontSize: "11px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "20px",
      }}
    >
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: "rgba(0,196,180,0.2)",
        color: "#00c4b4",
        fontWeight: 600,
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

const VALID_ROLES = ["admin", "analyst", "viewer"] as const;

export default function TeamManagement({
  members,
  pendingInvites,
  seatUsage,
  currentUserId,
  isAdmin,
}: Props) {
  const router = useRouter();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [successMessage,  setSuccessMessage]  = useState<string | null>(null);
  const [actionError,     setActionError]     = useState<string | null>(null);
  const [loadingId,       setLoadingId]       = useState<string | null>(null);

  const atLimit = seatUsage.used >= seatUsage.max;

  function clearMessages() {
    setSuccessMessage(null);
    setActionError(null);
  }

  async function handleRemoveMember(userId: string) {
    clearMessages();
    setLoadingId(userId);
    const result = await removeMember(userId);
    setLoadingId(null);
    if ("error" in result) {
      setActionError(result.error);
    } else {
      setSuccessMessage("Member removed.");
      router.refresh();
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    clearMessages();
    setLoadingId(userId + "-role");
    const result = await updateMemberRole(userId, newRole);
    setLoadingId(null);
    if ("error" in result) {
      setActionError(result.error);
    } else {
      router.refresh();
    }
  }

  async function handleUnlockMember(userId: string) {
    clearMessages();
    setLoadingId(userId + "-unlock");
    const result = await unlockMember(userId);
    setLoadingId(null);
    if ("error" in result) {
      setActionError(result.error);
    } else {
      setSuccessMessage("Account unlocked.");
      router.refresh();
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    clearMessages();
    setLoadingId(inviteId);
    const result = await revokeInvite(inviteId);
    setLoadingId(null);
    if ("error" in result) {
      setActionError(result.error);
    } else {
      setSuccessMessage("Invitation revoked.");
      router.refresh();
    }
  }

  const adminCount = members.filter(m => m.role === "admin" && m.status === "active").length;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Team Members</h1>
          <span
            style={{
              display: "inline-block",
              background: atLimit ? "rgba(249,115,22,0.1)" : "rgba(148,163,184,0.1)",
              color: atLimit ? "#f97316" : "#64748b",
              fontSize: "13px",
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: "20px",
            }}
          >
            {seatUsage.used}/{seatUsage.max} seats
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => { clearMessages(); setShowInviteModal(true); }}
            style={{
              background: "#00c4b4",
              color: "#0a0f1a",
              fontWeight: 700,
              fontSize: "14px",
              padding: "10px 20px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Invite Member
          </button>
        )}
      </div>

      {/* Feedback */}
      {successMessage && (
        <div
          style={{
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: "8px",
            padding: "12px 14px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#6ee7b7",
          }}
        >
          {successMessage}
        </div>
      )}
      {actionError && (
        <div
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            padding: "12px 14px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#fca5a5",
          }}
        >
          {actionError}
        </div>
      )}

      {/* Members */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Members</h2>
        </div>

        {members.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-slate-500 text-sm">You&apos;re the only member so far.</p>
            <p className="text-slate-400 text-sm mt-1">Invite your team to collaborate on security and compliance.</p>
          </div>
        ) : (
          <div>
            {members.map((member) => {
              const isSelf       = member.id === currentUserId;
              const isLastAdmin  = member.role === "admin" && adminCount <= 1;
              const canRemove    = isAdmin && !isSelf && !isLastAdmin;
              const canEditRole  = isAdmin && !isSelf;

              const isLocked = !!(member.lockout_until && new Date(member.lockout_until) > new Date());

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 last:border-0"
                >
                  <Avatar name={member.name} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {member.name || "(No name)"}
                      </span>
                      {isSelf && (
                        <span
                          style={{
                            background: "rgba(0,196,180,0.1)",
                            color: "#00c4b4",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          You
                        </span>
                      )}
                      {isLocked && (
                        <span
                          style={{
                            background: "rgba(239,68,68,0.1)",
                            color: "#ef4444",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          Locked
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{member.email}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Role selector or badge */}
                    {canEditRole ? (
                      <select
                        value={member.role}
                        disabled={loadingId === member.id + "-role"}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          fontSize: "12px",
                          color: "#475569",
                          cursor: "pointer",
                        }}
                      >
                        {VALID_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}

                    {/* Status */}
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: member.status === "active" ? "#10b981" : "#94a3b8",
                      }}
                    >
                      {member.status === "active" ? "Active" : "Inactive"}
                    </span>

                    {/* Unlock — admin only, shown when account is locked */}
                    {isAdmin && isLocked && (
                      <button
                        onClick={() => handleUnlockMember(member.id)}
                        disabled={loadingId === member.id + "-unlock"}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(239,68,68,0.4)",
                          color: "#ef4444",
                          fontSize: "12px",
                          cursor: loadingId === member.id + "-unlock" ? "not-allowed" : "pointer",
                          padding: "2px 8px",
                          borderRadius: "4px",
                        }}
                      >
                        {loadingId === member.id + "-unlock" ? "…" : "Unlock"}
                      </button>
                    )}

                    {/* Remove */}
                    {canRemove && (
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        disabled={loadingId === member.id}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#94a3b8",
                          fontSize: "12px",
                          cursor: loadingId === member.id ? "not-allowed" : "pointer",
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; }}
                      >
                        {loadingId === member.id ? "…" : "Remove"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Pending Invitations
            </h2>
          </div>
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 last:border-0"
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "rgba(148,163,184,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: "16px", color: "#94a3b8" }}>✉</span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{invite.email}</p>
                <p className="text-xs text-slate-400">
                  Invited by {invite.invited_by} · Expires{" "}
                  {new Date(invite.expires_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <RoleBadge role={invite.role} />
                {isAdmin && (
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={loadingId === invite.id}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      fontSize: "12px",
                      cursor: loadingId === invite.id ? "not-allowed" : "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; }}
                  >
                    {loadingId === invite.id ? "…" : "Revoke"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={(sentEmail) => {
            setShowInviteModal(false);
            setSuccessMessage(`Invitation sent to ${sentEmail}.`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
