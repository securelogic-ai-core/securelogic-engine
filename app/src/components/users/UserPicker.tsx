"use client";

import { useEffect, useState } from "react";

/**
 * UserPicker — generic user selector backed by the org's team roster.
 *
 * Fetches GET /api/team/members on mount (the engine derives org from
 * the session token). Filters to status='active' so deactivated members
 * and pending invitees are not assignable as current owners.
 *
 * Returns both the selected user's id AND their name to onChange so the
 * parent form can write both columns: `owner_user_id` (FK) and `owner`
 * (denormalized text fallback for display when the FK user is later
 * deleted).
 *
 * If the team-members fetch fails (network, auth, server), the
 * component degrades gracefully to a free-text input so users can still
 * record an owner name. The parent's submit logic detects the fallback
 * via the falling-back nature of the onChange call (userId === null)
 * and sends only the text column.
 */

type TeamMember = {
  id: string;
  name: string;
  email: string;
  status: string;
};

type ApiResponse = {
  members?: Array<TeamMember & Record<string, unknown>>;
};

export type UserPickerProps = {
  /**
   * Org ID for cache invalidation. The actual fetch is org-scoped via
   * the session token; this prop forces a re-fetch when an admin
   * switches org context.
   */
  organizationId: string;
  /** Current selected user id (the FK value). null = unassigned. */
  value: string | null;
  /**
   * Called with the picked user's id and name. When the user picks
   * "Unassigned", both args are null. When the picker has degraded to
   * the free-text fallback, userId is null and userName is whatever
   * the user typed.
   */
  onChange: (userId: string | null, userName: string | null) => void;
  disabled?: boolean;
  /** Show an "Unassigned" option at the top. Default true. */
  includeUnassigned?: boolean;
  /** Required for accessibility — applied as aria-label on the select. */
  ariaLabel: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(15,23,34,0.6)",
  border: "1px solid #1e293b",
  borderRadius: 6,
  color: "#e5e7eb",
  fontSize: 14,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#fca5a5",
  marginBottom: 4,
};

export function UserPicker({
  organizationId,
  value,
  onChange,
  disabled = false,
  includeUnassigned = true,
  ariaLabel,
}: UserPickerProps) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);

    fetch("/api/account/team/members", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status_${res.status}`);
        return res.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.members) ? data.members : [];
        const active = raw
          .filter((m) => m && typeof m.id === "string" && m.status === "active")
          .map((m) => ({
            id: m.id,
            name: typeof m.name === "string" && m.name.trim().length > 0 ? m.name : m.email,
            email: typeof m.email === "string" ? m.email : "",
            status: m.status,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setMembers(active);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading) {
    return (
      <select aria-label={ariaLabel} disabled style={inputStyle}>
        <option>Loading users…</option>
      </select>
    );
  }

  if (errored || members === null) {
    // Degrade to free text. Parent treats userId=null as "no FK", and
    // the typed string is sent as the owner text column only.
    return (
      <div>
        <p style={errorTextStyle}>Could not load team members; using free text.</p>
        <input
          type="text"
          aria-label={ariaLabel}
          value={value ?? ""}
          onChange={(e) => onChange(null, e.target.value || null)}
          disabled={disabled}
          maxLength={100}
          style={inputStyle}
        />
      </div>
    );
  }

  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => {
        const id = e.target.value;
        if (id === "") {
          onChange(null, null);
          return;
        }
        const picked = members.find((m) => m.id === id);
        onChange(id, picked?.name ?? null);
      }}
      disabled={disabled}
      style={inputStyle}
    >
      {includeUnassigned && <option value="">Unassigned</option>}
      {members.map((m) => (
        <option key={m.id} value={m.id} title={m.email}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
