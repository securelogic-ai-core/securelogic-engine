"use client";

/**
 * RelationshipDeterminationNotice — WA-3 / R8.
 *
 * An engagement copies its relationship's determination when it is opened and
 * then holds it. That is what makes a completed assessment reproducible: the
 * questions a vendor answered were chosen from the facts as they stood.
 *
 * The cost is that a relationship re-intake leaves a not-yet-issued engagement
 * quietly assessing against superseded facts, with nothing on screen to say so.
 * The owner walkthrough asked for three things, and this is all three:
 *
 *   1. say that the basis is stale;
 *   2. show exactly what changed;
 *   3. let the analyst explicitly rebase it — with a reason — but only while
 *      the engagement is still pre-issue, and without advancing anything.
 *
 * ── Two refusals this component is built around ─────────────────────────────
 *
 * It never offers the action on an issued engagement. Past issue the basis is
 * history: the vendor is answering questions chosen from those facts, and
 * rewriting them would restate an assessment already under way. The notice
 * still appears — an analyst should know the relationship has moved — but it
 * says to open a new engagement instead.
 *
 * It never recomposes. The reseed writes the copied basis and stops; the
 * analyst then runs the composition themselves and sees the resulting question
 * set BEFORE it replaces the current scope. A one-click "rebase and recompose"
 * would collapse two decisions into one and hide the second.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VendorEngagementRelationshipDetermination } from "@/lib/api";
import { reseedFromRelationship } from "@/app/actions/vendorEngagements";

export const RESEED_TRANSPORT_FAILURE =
  "The request did not reach SecureLogic, so nothing was changed. Check your connection and try again.";

/** The seventeen basis fields, in the analyst's language rather than the column's. */
const FIELD_LABEL: Record<string, string> = {
  data_sensitivity: "Data sensitivity",
  data_volume: "Data volume",
  access_level: "Access level",
  operational_dependency: "Operational dependency",
  recoverability: "Recoverability",
  business_criticality: "Business criticality",
  regulatory_exposure: "Regulatory exposure",
  regulatory_breach_notification: "Breach-notification duty",
  ai_involvement: "AI involvement",
  ai_autonomy: "AI autonomy",
  hosting_model: "Hosting model",
  fourth_party_exposure: "Fourth-party exposure",
  concentration: "Concentration",
  assessment_tier: "Assessment tier",
  inherent_score: "Inherent risk score",
  inherent_rating: "Inherent risk rating",
  inherent_arithmetic_rating: "Inherent risk (arithmetic)",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).replace(/_/g, " ");
};

export default function RelationshipDeterminationNotice({
  engagementId,
  determination,
}: {
  engagementId: string;
  determination: VendorEngagementRelationshipDetermination | null | undefined;
}): JSX.Element | null {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Nothing to say: no relationship, an older engine that does not send the
  // envelope, or a basis that still matches.
  if (!determination) return null;
  if (determination.indeterminate) {
    return (
      <section
        aria-label="Relationship determination"
        style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #374151", borderRadius: 8, background: "rgba(55,65,81,0.15)" }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>
          This engagement&apos;s relationship no longer produces a classification, so SecureLogic cannot tell whether the
          assessment basis is current. The engagement is unchanged and still assesses against the facts it was opened with.
        </p>
      </section>
    );
  }
  // A rebase that has just succeeded keeps its confirmation on screen.
  //
  // Without this the component is unmounted by its own success: router.refresh()
  // lands fresh server data in which the basis is no longer stale, the early
  // return below fires, and the analyst's next-step guidance disappears while
  // they are still reading it — taking the in-flight revalidation with it, which
  // then surfaces in a request log as a cancelled POST indistinguishable from a
  // mutation that failed. Found by the deployed-staging journey, where the abort
  // was intermittent.
  if (!determination.stale && done) {
    return (
      <section
        aria-label="Relationship determination"
        style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #166534", borderRadius: 8, background: "rgba(22,101,52,0.12)" }}
      >
        <p role="status" style={{ margin: 0, fontSize: 13, color: "#86efac" }}>
          {done}
        </p>
      </section>
    );
  }
  if (!determination.stale) return null;

  const changed = determination.changed_fields;
  const reseedable = determination.reseedable === true;
  const tooShort = reason.trim().length < 10;

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await reseedFromRelationship(engagementId, reason.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.nextStep);
      setReason("");
      router.refresh();
    });
  };

  return (
    <section
      aria-label="Relationship determination has changed"
      style={{ marginTop: 12, padding: "12px 14px", border: "1px solid #a16207", borderRadius: 8, background: "rgba(161,98,7,0.12)" }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fde68a" }}>
        The relationship has been re-assessed since this engagement was opened
      </h3>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#d1d5db" }}>
        {reseedable
          ? "This engagement still assesses against the facts it was opened with. You can rebase it onto the current determination before it is issued."
          : "This engagement was already issued, so the facts it was opened with are part of its history — the vendor is answering questions chosen from them. To assess against the current determination, open a new engagement."}
      </p>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "#fcd34d" }}>
          What changed ({changed.length} {changed.length === 1 ? "field" : "fields"})
        </summary>
        <table style={{ marginTop: 8, borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr style={{ color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "3px 8px 3px 0", fontWeight: 500 }}>Field</th>
              <th style={{ padding: "3px 8px", fontWeight: 500 }}>This engagement</th>
              <th style={{ padding: "3px 0 3px 8px", fontWeight: 500 }}>Relationship now</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((c) => (
              <tr key={c.field} style={{ color: "#d1d5db" }}>
                <td style={{ padding: "3px 8px 3px 0" }}>{FIELD_LABEL[c.field] ?? c.field}</td>
                <td style={{ padding: "3px 8px", color: "#9ca3af" }}>{show(c.engagement_value)}</td>
                <td style={{ padding: "3px 0 3px 8px", color: "#fcd34d" }}>{show(c.relationship_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {done && (
        <p role="status" style={{ margin: "10px 0 0", fontSize: 13, color: "#86efac" }}>
          {done}
        </p>
      )}

      {reseedable && !done && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="reseed-reason" style={{ fontSize: 12, color: "#9ca3af" }}>
            Why are you rebasing this engagement? Recorded against it permanently, with your name and the time.
          </label>
          <textarea
            id="reseed-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="At least 10 characters"
            style={{ padding: 8, fontSize: 13, borderRadius: 6, border: "1px solid #374151", background: "#0b1220", color: "#e5e7eb" }}
          />
          <div>
            <button
              type="button"
              onClick={submit}
              disabled={pending || tooShort}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #a16207",
                background: pending || tooShort ? "#1f2937" : "rgba(161,98,7,0.35)",
                color: pending || tooShort ? "#6b7280" : "#fde68a",
                cursor: pending || tooShort ? "not-allowed" : "pointer",
              }}
            >
              {pending ? "Rebasing…" : "Rebase onto current determination"}
            </button>
            <span style={{ marginLeft: 10, fontSize: 12, color: "#6b7280" }}>
              This updates the basis only. You will still run the composition to see the resulting questions.
            </span>
          </div>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: "#fca5a5" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
