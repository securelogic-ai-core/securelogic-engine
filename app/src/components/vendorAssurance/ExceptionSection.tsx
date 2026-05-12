/**
 * ExceptionSection — auditor exceptions / deviations and management's responses.
 *
 * Renders the extracted `exceptions` array as one card per exception
 * (control_id, description, auditor_assessment — the actual extraction-schema
 * fields; severity and remediation_plan do NOT exist in the schema and are a
 * deferred future-package enhancement), with each `management_responses` entry
 * joined in by `exception_ref`. Responses that don't reference a known
 * exception are listed separately. Below the curated cards, a FieldRow for each
 * of the two underlying material fields carries the "Overridden" badge and the
 * Edit affordance (overrides operate at whole-field granularity). Server
 * component.
 */

import type {
  VendorAssuranceExtractedField,
  VendorAssuranceExtractionSpan,
  VendorAssuranceFieldOverride,
} from "@/lib/api";
import {
  asObjectArray,
  fieldLabel,
  type ExceptionEntry,
  type ManagementResponseEntry,
} from "@/lib/vendorAssurance/fieldGroups";
import FieldRow from "./FieldRow";
import SectionCard from "./SectionCard";

type Props = {
  documentId: string;
  exceptions: VendorAssuranceExtractedField | undefined;
  managementResponses: VendorAssuranceExtractedField | undefined;
  exceptionsOverride: VendorAssuranceFieldOverride | null;
  managementResponsesOverride: VendorAssuranceFieldOverride | null;
  exceptionSpans: VendorAssuranceExtractionSpan[];
  managementResponseSpans: VendorAssuranceExtractionSpan[];
  canEdit: boolean;
  hasExtraction: boolean;
};

const BORDER = "#374151";
const MUTED = "#9ca3af";

function fieldText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim().length === 0 ? null : v;
  return String(v);
}

export default function ExceptionSection({
  documentId,
  exceptions,
  managementResponses,
  exceptionsOverride,
  managementResponsesOverride,
  exceptionSpans,
  managementResponseSpans,
  canEdit,
  hasExtraction,
}: Props): JSX.Element {
  const exceptionsValue = exceptionsOverride ? exceptionsOverride.override_value : exceptions?.value;
  const responsesValue = managementResponsesOverride ? managementResponsesOverride.override_value : managementResponses?.value;

  const exceptionEntries = asObjectArray<ExceptionEntry>(exceptionsValue);
  const responseEntries = asObjectArray<ManagementResponseEntry>(responsesValue);

  // Join management responses to exceptions by exception_ref === control_id.
  const matchedResponseIdx = new Set<number>();
  const responsesByRef = new Map<string, ManagementResponseEntry[]>();
  responseEntries.forEach((r) => {
    const ref = fieldText(r.exception_ref);
    if (ref) {
      const list = responsesByRef.get(ref) ?? [];
      list.push(r);
      responsesByRef.set(ref, list);
    }
  });
  const matchedFor = (controlId: string | null): ManagementResponseEntry[] => {
    if (!controlId) return [];
    const list = responsesByRef.get(controlId) ?? [];
    list.forEach((r) => {
      const idx = responseEntries.indexOf(r);
      if (idx >= 0) matchedResponseIdx.add(idx);
    });
    return list;
  };

  return (
    <SectionCard
      title="Exceptions and Deviations"
      subtitle="Auditor-noted exceptions and management's responses"
      aside={
        hasExtraction ? (
          <span style={{ fontSize: 12, color: MUTED }}>
            {exceptionEntries.length} {exceptionEntries.length === 1 ? "exception" : "exceptions"}
          </span>
        ) : undefined
      }
    >
      {!hasExtraction ? (
        <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>No extraction is available for this document yet.</p>
      ) : (
        <>
          {exceptionEntries.length === 0 ? (
            <p style={{ color: "#86efac", fontSize: 13, margin: 0 }}>No exceptions or deviations were noted in this report.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {exceptionEntries.map((ex, i) => {
                const controlId = fieldText(ex.control_id);
                const description = fieldText(ex.description);
                const assessment = fieldText(ex.auditor_assessment);
                const responses = matchedFor(controlId);
                return (
                  <article key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, background: "rgba(31,41,55,0.7)", color: "#e5e7eb" }}>
                        {controlId ? `Control ${controlId}` : `Exception ${i + 1}`}
                      </span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                      {description ?? <span style={{ color: MUTED }}>(no description extracted)</span>}
                    </div>
                    {assessment && (
                      <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>
                        <span style={{ color: "#9ca3af", fontWeight: 600 }}>Auditor assessment: </span>
                        {assessment}
                      </div>
                    )}
                    {responses.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
                        <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>
                          Management response{responses.length === 1 ? "" : "s"}
                        </div>
                        {responses.map((r, j) => (
                          <div key={j} style={{ fontSize: 12, lineHeight: 1.5 }}>
                            {fieldText(r.response) ?? <span style={{ color: MUTED }}>(no response text extracted)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* Management responses that don't reference a known exception. */}
          {(() => {
            const unmatched = responseEntries.filter((_, i) => !matchedResponseIdx.has(i));
            if (unmatched.length === 0) return null;
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>
                  Other management responses (no matching exception reference)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {unmatched.map((r, i) => (
                    <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5 }}>
                      {fieldText(r.exception_ref) && (
                        <div style={{ color: MUTED, marginBottom: 2 }}>ref: {fieldText(r.exception_ref)}</div>
                      )}
                      {fieldText(r.response) ?? <span style={{ color: MUTED }}>(no response text extracted)</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Underlying extracted fields — override badge + Edit affordance. */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>Underlying extracted data</div>
            <FieldRow
              documentId={documentId}
              fieldName="exceptions"
              label={fieldLabel("exceptions")}
              value={exceptionsValue ?? null}
              overrideState={exceptionsOverride}
              confidence={exceptionsOverride ? null : exceptions?.confidence ?? null}
              sourceSpans={exceptionSpans}
              canEdit={canEdit}
              layout="block"
            />
            <FieldRow
              documentId={documentId}
              fieldName="management_responses"
              label={fieldLabel("management_responses")}
              value={responsesValue ?? null}
              overrideState={managementResponsesOverride}
              confidence={managementResponsesOverride ? null : managementResponses?.confidence ?? null}
              sourceSpans={managementResponseSpans}
              canEdit={canEdit}
              layout="block"
            />
          </div>
        </>
      )}
    </SectionCard>
  );
}
