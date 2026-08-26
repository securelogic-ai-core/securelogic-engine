/**
 * ResponsesSection — the reviewer's view of the questionnaire itself (VA-R1).
 *
 * Renders exactly what the engine's /responses surface reports: per question,
 * the vendor's current answer, their notes, evidence coverage, and the
 * append-only revision history. Nothing is computed here — answered counts,
 * truncation, and statuses all come from the engine, so this panel can never
 * disagree with the scores derived from the same rows.
 *
 * Pre-issue (draft/scoped) the same data IS the "what will be sent" preview —
 * every response is null — which is the owner-ruled answer to "can the client
 * see what the vendor will be asked before sending?" (2026-08-23).
 *
 * Three states, never collapsed: rows, a scoped-but-empty notice, and an
 * outage notice. "No answers yet" and "couldn't load answers" are different
 * facts and are rendered differently.
 */

import type { VendorEngagementResponses, VendorEngagementResponseItem } from "@/lib/api";

const STATUS_STYLE: Record<string, { label: string; fg: string; bg: string; border: string }> = {
  pass: { label: "Pass", fg: "#86efac", bg: "rgba(22,101,52,0.2)", border: "#166534" },
  fail: { label: "Fail", fg: "#fca5a5", bg: "rgba(127,29,29,0.25)", border: "#b91c1c" },
  partial: { label: "Partial", fg: "#fcd34d", bg: "rgba(161,98,7,0.2)", border: "#a16207" },
  not_applicable: {
    label: "Not applicable",
    fg: "#93c5fd",
    bg: "rgba(30,58,138,0.25)",
    border: "#1d4ed8",
  },
  not_assessed: { label: "Not answered", fg: "#9ca3af", bg: "rgba(55,65,81,0.3)", border: "#374151" },
};

function statusChip(status: string | null) {
  const s = STATUS_STYLE[status ?? "not_assessed"] ?? STATUS_STYLE["not_assessed"]!;
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 999,
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function fmtDate(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function ResponseRow({ item }: { item: VendorEngagementResponseItem }) {
  const r = item.response;
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px solid #374151",
        borderRadius: 8,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#93c5fd" }}>
          {item.requirement.reference}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{item.requirement.title}</span>
        {item.scope.mandatory ? (
          <span style={{ fontSize: 11, color: "#fcd34d" }}>required</span>
        ) : (
          <span style={{ fontSize: 11, color: "#6b7280" }}>additional</span>
        )}
        <span style={{ marginLeft: "auto" }}>{statusChip(r?.status ?? null)}</span>
      </div>

      {item.requirement.description ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>{item.requirement.description}</div>
      ) : null}

      {r?.notes ? (
        <div
          style={{
            fontSize: 13,
            color: "#e5e7eb",
            background: "rgba(31,41,55,0.5)",
            border: "1px solid #374151",
            borderRadius: 6,
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
          }}
        >
          {r.notes}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#9ca3af", flexWrap: "wrap" }}>
        {r ? (
          <span>
            Answered by {r.responder_type === "vendor" ? "the vendor" : "your team"}
            {r.assessed_at ? ` · ${fmtDate(r.assessed_at)}` : ""}
          </span>
        ) : (
          <span>No answer recorded</span>
        )}
        <span>
          Evidence: {item.evidence.count}
          {item.evidence.count > 0 ? (item.evidence.confirmed ? " (confirmed)" : " (unreviewed)") : ""}
        </span>
        {item.revisions.total > 1 ? (
          <span>
            {item.revisions.total} versions{item.revisions.truncated ? " (history capped)" : ""}
            {" · first "}
            {fmtDate(item.revisions.entries[0]?.created_at ?? null)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function ResponsesSection({
  responses,
  loadFailed,
}: {
  responses: VendorEngagementResponses | null;
  loadFailed: boolean;
}) {
  const preIssue =
    responses !== null && ["draft", "scoped"].includes(responses.engagement_status);

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
        {preIssue ? "Questionnaire preview — what will be sent" : "Questionnaire responses"}
      </h2>
      <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px" }}>
        {preIssue
          ? "These are the questions this engagement will ask the vendor, derived from your activated frameworks and this engagement's intake. Curate framework questions to change what is asked."
          : "The vendor's answers as saved — the same rows the scores are computed from."}
      </p>

      {loadFailed ? (
        <div
          style={{
            padding: 16,
            border: "1px dashed #a16207",
            borderRadius: 8,
            color: "#fcd34d",
            fontSize: 13,
          }}
        >
          The questionnaire could not be loaded right now. This is an outage, not an empty
          questionnaire — retry shortly.
        </div>
      ) : responses === null || responses.items.length === 0 ? (
        <div
          style={{
            padding: 16,
            border: "1px dashed #374151",
            borderRadius: 8,
            color: "#9ca3af",
            fontSize: 13,
          }}
        >
          No questionnaire scope has been resolved for this engagement yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            {responses.counts.answered}/{responses.counts.scoped} answered ·{" "}
            {responses.counts.mandatory} required
          </div>
          {responses.items.map((item) => (
            <ResponseRow key={item.requirement.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
