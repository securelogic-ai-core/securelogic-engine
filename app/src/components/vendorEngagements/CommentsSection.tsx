"use client";

/**
 * CommentsSection — the two-sided clarification thread.
 *
 * The visibility choice is EXPLICIT and unmistakable: internal (default, never
 * leaves this surface) versus vendor-visible. Posting a vendor-visible message
 * while the engagement is In review IS the clarification request — it moves the
 * engagement to Clarification requested — and the composer says so before the
 * reviewer commits, not after.
 */

import { useState, useTransition } from "react";
import type { VendorEngagementComment } from "@/lib/api";
import { postComment } from "@/app/actions/vendorEngagements";
import { canComment, type EngagementState, ENGAGEMENT_STATE_LABELS } from "@/lib/vendorEngagements";

type Props = {
  engagementId: string;
  state: EngagementState;
  comments: VendorEngagementComment[];
};

function fmt(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CommentsSection({ engagementId, state, comments }: Props): JSX.Element {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "vendor">("internal");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const composerOpen = canComment(state);
  const willRequestClarification = visibility === "vendor" && state === "in_review";

  const submit = () => {
    setError(null);
    setNotice(null);
    const text = body.trim();
    if (text.length === 0) return;
    startTransition(async () => {
      const r = await postComment(engagementId, text, visibility);
      if (r.ok) {
        setBody("");
        setVisibility("internal");
        setNotice(
          r.status === "clarification_requested" && state === "in_review"
            ? "Sent to the vendor — the engagement is now in Clarification requested."
            : visibility === "vendor"
              ? "Sent to the vendor."
              : "Internal note recorded."
        );
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <section style={card()}>
      <h2 style={h2()}>Clarification thread ({comments.length})</h2>

      {comments.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 13 }}>
          No comments yet. Internal notes stay on this surface; vendor-visible questions reach
          the vendor portal.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {comments.map((c) => {
          const fromVendor = c.author_type === "vendor";
          const internalOnly = c.visibility === "internal";
          return (
            <div
              key={c.id}
              style={{
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${internalOnly ? "#1f2937" : "rgba(37,99,235,0.4)"}`,
                background: internalOnly ? "rgba(2,6,23,0.5)" : "rgba(37,99,235,0.08)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600 }}>
                  {fromVendor ? (c.author_display_name ?? "Vendor") : (c.author_display_name ?? "Reviewer")}
                </span>
                <span
                  style={{
                    padding: "1px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    background: fromVendor
                      ? "rgba(37,99,235,0.18)"
                      : internalOnly
                        ? "rgba(31,41,55,0.7)"
                        : "rgba(37,99,235,0.18)",
                    color: fromVendor ? "#93c5fd" : internalOnly ? "#9ca3af" : "#93c5fd",
                    border: `1px solid ${fromVendor || !internalOnly ? "rgba(37,99,235,0.4)" : "#374151"}`,
                  }}
                >
                  {fromVendor ? "From vendor" : internalOnly ? "Internal only" : "Visible to vendor"}
                </span>
                {c.requirement_reference && (
                  <span style={{ color: "#6b7280", fontSize: 12 }}>on {c.requirement_reference}</span>
                )}
                <span style={{ color: "#6b7280", fontSize: 12, marginLeft: "auto" }}>
                  {fmt(c.created_at)}
                </span>
              </div>
              <div style={{ color: "#d1d5db", fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                {c.body}
              </div>
            </div>
          );
        })}
      </div>

      {composerOpen ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={8000}
            disabled={pending}
            placeholder="Write a note…"
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
              fontSize: 13,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={radioLbl(visibility === "internal")}>
              <input
                type="radio"
                name="comment-visibility"
                checked={visibility === "internal"}
                onChange={() => setVisibility("internal")}
                disabled={pending}
              />
              Internal only — reviewers see it, the vendor never does
            </label>
            <label style={radioLbl(visibility === "vendor")}>
              <input
                type="radio"
                name="comment-visibility"
                checked={visibility === "vendor"}
                onChange={() => setVisibility("vendor")}
                disabled={pending}
              />
              Visible to vendor — sent to the vendor portal
            </label>
          </div>
          {willRequestClarification && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(161,98,7,0.12)",
                border: "1px solid #a16207",
                color: "#fcd34d",
                fontSize: 12,
              }}
            >
              This is a clarification request: posting it moves the engagement from In review to
              Clarification requested, and the vendor can respond in the portal.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending || body.trim().length === 0}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                border: "none",
                background:
                  pending || body.trim().length === 0
                    ? "#1f2937"
                    : visibility === "vendor"
                      ? "#a16207"
                      : "#2563eb",
                color: pending || body.trim().length === 0 ? "#6b7280" : "#fff",
                cursor: pending || body.trim().length === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              {pending
                ? "Posting…"
                : visibility === "vendor"
                  ? willRequestClarification
                    ? "Send to vendor (requests clarification)"
                    : "Send to vendor"
                  : "Add internal note"}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ color: "#6b7280", fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          This engagement is {ENGAGEMENT_STATE_LABELS[state].toLowerCase()} — the thread is
          closed to new comments.
        </p>
      )}

      {notice && <div style={{ marginTop: 10, fontSize: 13, color: "#86efac" }}>{notice}</div>}
      {error && <div style={{ marginTop: 10, fontSize: 13, color: "#fca5a5" }}>{error}</div>}
    </section>
  );
}

function radioLbl(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: active ? "#e5e7eb" : "#9ca3af",
    cursor: "pointer",
  };
}

function card(): React.CSSProperties {
  return {
    padding: 20,
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "rgba(15,23,42,0.5)",
  };
}

function h2(): React.CSSProperties {
  return { fontSize: 16, fontWeight: 600, margin: "0 0 12px" };
}
