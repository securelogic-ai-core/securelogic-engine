/**
 * CuecSection — the Complementary User Entity Controls section.
 *
 * Two parts:
 *   1. The matching surface (CuecMatchingPanel, client): one card per extracted
 *      CUEC showing its mapping status against the customer's controls
 *      inventory — suggested matches with Accept/Dismiss, accepted controls as
 *      chips, or "no applicable control" — plus a Re-match button. CUEC mapping
 *      is its own workflow: it is editable regardless of the extraction's
 *      approve/reject state (unlike field overrides).
 *   2. The underlying extracted `cuecs` array, rendered via the FieldRow
 *      primitive so the reviewer can still override the whole list with a
 *      reason ("the AI got the CUEC list wrong") — that override is what's
 *      locked on approve/reject/finalized, and overriding it triggers a CUEC
 *      re-extract + re-match server-side.
 *
 * Server component; CuecMatchingPanel and FieldRow are client components.
 */

import type {
  VendorAssuranceExtractedField,
  VendorAssuranceExtractionSpan,
  VendorAssuranceFieldOverride,
  VendorAssuranceCuecsResponse,
} from "@/lib/api";
import { fieldLabel } from "@/lib/vendorAssurance/fieldGroups";
import FieldRow from "./FieldRow";
import SectionCard from "./SectionCard";
import CuecMatchingPanel from "./CuecMatchingPanel";

type Props = {
  documentId: string;
  cuecsData: VendorAssuranceCuecsResponse | null;
  /** Raw extracted `cuecs` field (array_of_strings), for the override FieldRow. */
  cuecsField: VendorAssuranceExtractedField | undefined;
  cuecsOverride: VendorAssuranceFieldOverride | null;
  cuecsSpans: VendorAssuranceExtractionSpan[];
  /** Whether the whole-list override is allowed (locked on approved/rejected/finalized). */
  canEditOverride: boolean;
  hasExtraction: boolean;
};

const DEFAULT_DATA = (documentId: string): VendorAssuranceCuecsResponse => ({
  document_id: documentId,
  cuecs: [],
  match_score_min_threshold: 60,
  match_score_high_confidence: 85,
});

export default function CuecSection({
  documentId,
  cuecsData,
  cuecsField,
  cuecsOverride,
  cuecsSpans,
  canEditOverride,
  hasExtraction,
}: Props): JSX.Element {
  return (
    <SectionCard
      title="Complementary User Entity Controls"
      subtitle="Each control statement the vendor's auditor says you are responsible for, mapped to your controls inventory."
    >
      {!hasExtraction ? (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>No extraction is available for this document yet.</p>
      ) : (
        <>
          <CuecMatchingPanel documentId={documentId} data={cuecsData ?? DEFAULT_DATA(documentId)} />

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Underlying extracted CUEC list</div>
            <FieldRow
              documentId={documentId}
              fieldName="cuecs"
              label={fieldLabel("cuecs")}
              value={cuecsOverride ? cuecsOverride.override_value : cuecsField?.value ?? null}
              overrideState={cuecsOverride}
              confidence={cuecsOverride ? null : cuecsField?.confidence ?? null}
              sourceSpans={cuecsSpans}
              canEdit={canEditOverride}
              layout="block"
            />
          </div>
        </>
      )}
    </SectionCard>
  );
}
