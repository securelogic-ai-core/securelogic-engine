/**
 * CoverSheetSection — the "what is this report" facts: vendor, report type,
 * period, issue date, auditor, opinion, Trust Services Criteria, subservice
 * handling, and the controls-tested summary. One FieldRow per cover-sheet
 * field, in label | value layout. Server component; FieldRow (client) carries
 * the Edit affordance.
 */

import type {
  VendorAssuranceExtractedField,
  VendorAssuranceExtractionSpan,
  VendorAssuranceFieldOverride,
} from "@/lib/api";
import { fieldLabel } from "@/lib/vendorAssurance/fieldGroups";
import FieldRow from "./FieldRow";
import SectionCard from "./SectionCard";

type Props = {
  documentId: string;
  fields: Array<{ fieldName: string; field: VendorAssuranceExtractedField | undefined }>;
  overridesByField: Record<string, VendorAssuranceFieldOverride>;
  spansByField: Record<string, VendorAssuranceExtractionSpan[]>;
  canEdit: boolean;
  hasExtraction: boolean;
};

export default function CoverSheetSection({
  documentId,
  fields,
  overridesByField,
  spansByField,
  canEdit,
  hasExtraction,
}: Props): JSX.Element {
  return (
    <SectionCard title="Cover Sheet" subtitle="Identity, period, auditor opinion, and the controls tested">
      {!hasExtraction ? (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>No extraction is available for this document yet.</p>
      ) : (
        <div>
          {fields.map(({ fieldName, field }) => {
            const override = overridesByField[fieldName] ?? null;
            const value = override ? override.override_value : field?.value;
            return (
              <FieldRow
                key={fieldName}
                documentId={documentId}
                fieldName={fieldName}
                label={fieldLabel(fieldName)}
                value={value}
                overrideState={override}
                confidence={override ? null : field?.confidence ?? null}
                sourceSpans={spansByField[fieldName] ?? []}
                canEdit={canEdit}
                layout="row"
              />
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
