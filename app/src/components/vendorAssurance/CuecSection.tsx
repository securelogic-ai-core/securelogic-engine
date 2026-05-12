/**
 * CuecSection — the Complementary User Entity Controls. The SOC extraction
 * stores `cuecs` as a flat array of strings (no per-item structure, no per-item
 * spans), so this is one FieldRow: a bulleted list of the CUEC statements, the
 * "Overridden" badge + Edit affordance, and — if any source span happens to be
 * tagged field_name = "cuecs" — a collapsible block of that supporting
 * evidence beneath the list. Server component.
 */

import type {
  VendorAssuranceExtractedField,
  VendorAssuranceExtractionSpan,
  VendorAssuranceFieldOverride,
} from "@/lib/api";
import { asStringArray, fieldLabel } from "@/lib/vendorAssurance/fieldGroups";
import FieldRow from "./FieldRow";
import SectionCard from "./SectionCard";

type Props = {
  documentId: string;
  cuecs: VendorAssuranceExtractedField | undefined;
  override: VendorAssuranceFieldOverride | null;
  spans: VendorAssuranceExtractionSpan[];
  canEdit: boolean;
  hasExtraction: boolean;
};

export default function CuecSection({ documentId, cuecs, override, spans, canEdit, hasExtraction }: Props): JSX.Element {
  const value = override ? override.override_value : cuecs?.value ?? null;
  const count = asStringArray(value).length;

  return (
    <SectionCard
      title="Complementary User Entity Controls"
      subtitle="Controls the report assumes the user organization operates"
      aside={
        hasExtraction ? (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{count} {count === 1 ? "control" : "controls"}</span>
        ) : undefined
      }
    >
      {!hasExtraction ? (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>No extraction is available for this document yet.</p>
      ) : (
        <FieldRow
          documentId={documentId}
          fieldName="cuecs"
          label={fieldLabel("cuecs")}
          value={value}
          overrideState={override}
          confidence={override ? null : cuecs?.confidence ?? null}
          sourceSpans={spans}
          canEdit={canEdit}
          layout="block"
        />
      )}
    </SectionCard>
  );
}
