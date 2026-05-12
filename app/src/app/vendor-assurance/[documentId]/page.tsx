import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendorAssuranceDocument,
  getVendorAssuranceExtraction,
  getCuecsForDocument,
  getVendorAssuranceDocumentPdfUrl,
  type VendorAssuranceDocument,
  type VendorAssuranceExtractionResponse,
  type VendorAssuranceExtractionSpan,
  type VendorAssuranceFieldOverride,
  type VendorAssuranceCuecsResponse,
} from "@/lib/api";
import { groupExtractedFields } from "@/lib/vendorAssurance/fieldGroups";
import PdfPreviewLoader from "@/components/vendorAssurance/PdfPreviewLoader";
import DocumentActions from "@/components/vendorAssurance/DocumentActions";
import CoverSheetSection from "@/components/vendorAssurance/CoverSheetSection";
import CuecSection from "@/components/vendorAssurance/CuecSection";
import ExceptionSection from "@/components/vendorAssurance/ExceptionSection";

const PAGE_BG = "#020617";

const ERROR_MESSAGES: Record<string, string> = {
  pdf_image_only:   "The uploaded PDF appears to be image-only or scanned. Phase 1 does not perform OCR; please upload a text-bearing PDF.",
  pdf_unparseable:  "The PDF could not be parsed (it may be corrupt, password-protected, or in an unsupported format).",
  llm_unavailable:  "The extraction model is not configured for this environment (ANTHROPIC_API_KEY absent).",
  llm_invalid_json: "The extraction model returned a response that did not match the expected schema. Re-upload to retry.",
  llm_failed:       "The extraction model call failed. Re-upload to retry.",
};

function indexByField<T extends { field_name: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) {
    // Engine already returns the latest override per field (DISTINCT ON);
    // for spans this keeps the first-seen, which is fine — they're grouped below.
    if (!(r.field_name in out)) out[r.field_name] = r;
  }
  return out;
}

function groupSpansByField(spans: VendorAssuranceExtractionSpan[]): Record<string, VendorAssuranceExtractionSpan[]> {
  const out: Record<string, VendorAssuranceExtractionSpan[]> = {};
  for (const s of spans) {
    (out[s.field_name] ??= []).push(s);
  }
  return out;
}

export default async function VendorAssuranceDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const { documentId } = await params;

  const [document, extractionResp, cuecsData]: [
    VendorAssuranceDocument | null,
    VendorAssuranceExtractionResponse | null,
    VendorAssuranceCuecsResponse | null
  ] = await Promise.all([
    getVendorAssuranceDocument(token, documentId),
    getVendorAssuranceExtraction(token, documentId),
    getCuecsForDocument(token, documentId),
  ]);

  if (!document) {
    return (
      <main style={{ padding: 32, color: "#e5e7eb", background: PAGE_BG, minHeight: "100vh" }}>
        <h1 style={{ fontSize: 22 }}>Document not found</h1>
        <Link href="/vendor-assurance/queue" style={{ color: "#93c5fd" }}>← Back to queue</Link>
      </main>
    );
  }

  const status = document.processing_status;
  const isFailed = status === "extraction_failed";
  const isInFlight = status === "pending" || status === "extracting";

  const extraction = extractionResp?.extraction ?? null;
  const hasExtraction = !!extraction;
  const spansByField = groupSpansByField(extractionResp?.spans ?? []);
  const overridesByField = indexByField<VendorAssuranceFieldOverride>(extractionResp?.field_overrides ?? []);
  const grouped = groupExtractedFields(extraction);
  // Overrides are refused by the engine on approved / rejected / finalized
  // documents (locked states); nothing to edit before an extraction exists
  // either. 'manual_review_requested' stays editable.
  const canEdit = hasExtraction && status !== "approved" && status !== "rejected" && status !== "finalized";
  const pdfUrl = getVendorAssuranceDocumentPdfUrl(documentId);

  return (
    <main style={{ background: PAGE_BG, minHeight: "100vh", color: "#e5e7eb" }}>
      <style>{`
        .va-two-panel { display: grid; grid-template-columns: 1fr; gap: 24px; }
        .va-pdf-col { position: static; }
        @media (min-width: 1024px) {
          .va-two-panel { grid-template-columns: 2fr 3fr; align-items: start; }
          .va-pdf-col { position: sticky; top: 92px; }
        }
      `}</style>

      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(2,6,23,0.92)",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid #374151",
          padding: "14px 32px",
        }}
      >
        <div style={{ maxWidth: 1500, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <Link href="/vendor-assurance/queue" style={{ color: "#93c5fd", fontSize: 12 }}>← Queue</Link>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {document.original_filename}
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>
              Vendor:{" "}
              <Link href={`/vendors/${document.vendor_id}`} style={{ color: "#93c5fd" }}>
                {document.vendor_id.slice(0, 8)}…
              </Link>
              {" · "}Uploaded {new Date(document.created_at).toLocaleString()}
              {document.document_type_hint ? ` · ${document.document_type_hint}` : ""}
            </p>
          </div>
          <DocumentActions
            documentId={documentId}
            status={status}
            approvedAt={document.approved_at}
            finalizedAt={document.finalized_at}
          />
        </div>
      </header>

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 32px 64px" }}>
        {isFailed && (
          <section style={{ marginBottom: 20, padding: 16, border: "1px solid #b91c1c", borderRadius: 8, background: "rgba(127,29,29,0.15)" }}>
            <strong style={{ color: "#fca5a5" }}>Extraction failed{document.processing_error_code ? `: ${document.processing_error_code}` : ""}</strong>
            <p style={{ marginTop: 6, color: "#fca5a5", fontSize: 13 }}>
              {(document.processing_error_code && ERROR_MESSAGES[document.processing_error_code]) ?? document.processing_error_detail ?? "No further detail recorded."}
            </p>
          </section>
        )}

        {isInFlight && (
          <section style={{ marginBottom: 20, padding: 16, border: "1px solid #374151", borderRadius: 8, color: "#9ca3af", fontSize: 13 }}>
            Extraction is in progress. Refresh to check status.
          </section>
        )}

        <div className="va-two-panel">
          <div className="va-pdf-col">
            <PdfPreviewLoader fileUrl={pdfUrl} width={560} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <CoverSheetSection
              documentId={documentId}
              fields={grouped.coverSheet}
              overridesByField={overridesByField}
              spansByField={spansByField}
              canEdit={canEdit}
              hasExtraction={hasExtraction}
            />
            <CuecSection
              documentId={documentId}
              cuecsData={cuecsData}
              cuecsField={grouped.cuecs}
              cuecsOverride={overridesByField["cuecs"] ?? null}
              cuecsSpans={spansByField["cuecs"] ?? []}
              canEditOverride={canEdit}
              hasExtraction={hasExtraction}
            />
            <ExceptionSection
              documentId={documentId}
              exceptions={grouped.exceptions}
              managementResponses={grouped.managementResponses}
              exceptionsOverride={overridesByField["exceptions"] ?? null}
              managementResponsesOverride={overridesByField["management_responses"] ?? null}
              exceptionSpans={spansByField["exceptions"] ?? []}
              managementResponseSpans={spansByField["management_responses"] ?? []}
              canEdit={canEdit}
              hasExtraction={hasExtraction}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
