"use client";

import Link from "next/link";

import type { RiskAcceptance } from "@/lib/api";
import {
  acceptanceNarrative,
  canDecide,
  partitionAcceptances,
  type AcceptanceTone,
} from "./riskAcceptanceView";

/**
 * GovernanceBanner — P1 (2026-07-15). The LOUD governance status.
 *
 * A Finding with a LIVE Risk Acceptance must announce its governance state, owner,
 * requester, approver, next required action, submission date and review date at the TOP of
 * the page — never leaving a user to infer it from the Decision dropdown value. This is the
 * one element that answers "did I propose, approve, or merely change a label?" at a glance.
 *
 * Renders nothing when there is no live acceptance (the terminal history lives in the panel
 * below). Pure presentation over the shared `riskAcceptanceView` model — no fetching, no
 * duplicated state logic.
 */

const TONE: Record<
  AcceptanceTone,
  { bg: string; border: string; fg: string; icon: string; heading: string }
> = {
  pending: {
    bg: "rgba(217,119,6,0.10)",
    border: "rgba(217,119,6,0.50)",
    fg: "#fbbf24",
    icon: "🟠",
    heading: "Risk Acceptance — Pending Approval",
  },
  binding: {
    bg: "rgba(22,163,74,0.10)",
    border: "rgba(22,163,74,0.50)",
    fg: "#86efac",
    icon: "🟢",
    heading: "Risk Accepted — Governed",
  },
  legacy: {
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.45)",
    fg: "#93c5fd",
    icon: "🔵",
    heading: "Risk Acceptance — Needs Completion",
  },
  // Terminal tones never reach the banner (partitionAcceptances keeps them out of `live`),
  // but the map must be total.
  reopened: {
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.35)",
    fg: "#cbd5e1",
    icon: "⚪",
    heading: "Risk Acceptance",
  },
  declined: {
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.35)",
    fg: "#cbd5e1",
    icon: "⚪",
    heading: "Risk Acceptance",
  },
};

/** date-only or timestamp → YYYY-MM-DD; em-dash when absent. */
function fmtDate(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : "—";
}

function personLabel(
  name: string | null | undefined,
  email: string | null | undefined,
  fallback: string
): string {
  return name || email || fallback;
}

export function GovernanceBanner({
  acceptances,
  currentUserId,
}: {
  acceptances: RiskAcceptance[];
  currentUserId: string | null;
}) {
  const { live } = partitionAcceptances(acceptances);
  if (!live) return null;

  const narrative = acceptanceNarrative(live);
  const t = TONE[narrative.tone];

  const owner = personLabel(live.owner_name, live.owner_email, "Unassigned");
  const requester = personLabel(live.requested_by_name, live.requested_by_email, "an authorized user");
  const approver =
    live.state === "approved"
      ? personLabel(live.approver_name, live.approver_email, "—")
      : "Any authorized user (≠ requester)";

  // The next required action — STATED, never inferred from a status value.
  let nextAction: string;
  if (live.state === "proposed") {
    nextAction = canDecide(live, currentUserId)
      ? "You may approve or reject this proposal."
      : live.is_self_proposed
        ? "Awaiting approval — you proposed this, so a different authorized user must approve or reject it."
        : "Awaiting approval from a different authorized user.";
  } else if (live.state === "approved") {
    nextAction = `Review before ${fmtDate(live.expires_at)} — the acceptance lapses on that date and the finding reopens.`;
  } else {
    nextAction =
      "Complete governance: withdraw this historical acceptance (which reopens the finding) and propose a fully-signed one.";
  }

  return (
    <div
      role="status"
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span aria-hidden style={{ fontSize: 16 }}>
            {t.icon}
          </span>
          <strong style={{ color: t.fg, fontSize: 15 }}>{t.heading}</strong>
        </div>
        {/* Anchors to the full lifecycle panel, which carries the meaning/history. The
            banner deliberately does NOT repeat the panel's prose — it is the scannable
            summary (state + who + next + dates); the panel is the detail. */}
        <Link href="#risk-acceptance" style={{ fontSize: 12, color: "#93c5fd" }}>
          View acceptance ↓
        </Link>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5 }}>
        <Field label="Owner" value={owner} />
        <Field label="Requester" value={requester} />
        <Field label="Approver" value={approver} />
        {/* Explicit approvals arithmetic: the workflow is single-approver, and
            the banner says so — "how many sign-offs remain" must never be
            inferred from prose. */}
        <Field
          label="Approvals"
          value={
            live.state === "approved"
              ? "1 of 1 — complete"
              : live.state === "proposed"
                ? "0 of 1 — one approval remaining"
                : "not recorded — needs a fully-signed acceptance"
          }
        />
        <Field label="Submitted" value={fmtDate(live.created_at)} />
        {live.state === "approved" ? <Field label="Approved" value={fmtDate(live.approved_at)} /> : null}
        <Field label="Review by" value={fmtDate(live.expires_at)} />
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 13 }}>
        <span style={{ color: t.fg, fontWeight: 600 }}>Next:</span>
        <span style={{ color: "#e2e8f0" }}>{nextAction}</span>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <span style={{ color: "#64748b" }}>{label}:</span>
      <span style={{ color: "#e2e8f0" }}>{value}</span>
    </span>
  );
}
