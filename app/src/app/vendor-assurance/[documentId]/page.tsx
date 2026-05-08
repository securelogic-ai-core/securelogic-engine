import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  getVendorAssuranceDocument,
  getVendorAssuranceExtraction,
  getVendorAssuranceDocumentPdfUrl,
  recordVendorAssuranceReviewDecisions,
  finalizeVendorAssuranceDocument,
  type VendorAssuranceDocument,
  type VendorAssuranceExtractionResponse,
  type VendorAssuranceExtractionSpan,
} from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  pdf_image_only:    "The uploaded PDF appears to be image-only or scanned. Phase 1 does not perform OCR; please upload a text-bearing PDF.",
  pdf_unparseable:   "The PDF could not be parsed (it may be corrupt, password-protected, or in an unsupported format).",
  llm_unavailable:   "The extraction model is not configured for this environment (ANTHROPIC_API_KEY absent).",
  llm_invalid_json:  "The extraction model returned a response that did not match the expected schema. Re-upload to retry.",
  llm_failed:        "The extraction model call failed. Re-upload to retry.",
};

function fmtConfidenceChip(confidence: number): { label: string; color: string } {
  if (confidence >= 0.8) return { label: "High",   color: "#86efac" };
  if (confidence >= 0.5) return { label: "Medium", color: "#fcd34d" };
  return { label: "Low", color: "#fca5a5" };
}

function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

// Server actions are colocated with the page so we don't need extra proxy
// routes. Each action re-reads the session token (server-only) before talking
// to the engine.

async function recordDecisionAction(formData: FormData): Promise<void> {
  "use server";
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return;
  const extractionId = String(formData.get("extraction_id") ?? "");
  const fieldName = String(formData.get("field_name") ?? "");
  const decision = String(formData.get("decision") ?? "") as "accept" | "edit" | "reject";
  const documentId = String(formData.get("document_id") ?? "");
  if (!extractionId || !fieldName || !documentId) return;

  const reviewerNoteRaw = formData.get("reviewer_note");
  const reviewerNote = typeof reviewerNoteRaw === "string" && reviewerNoteRaw.trim().length > 0
    ? reviewerNoteRaw.trim()
    : null;

  const decisionInput: {
    field_name: string;
    decision: "accept" | "edit" | "reject";
    reviewed_value?: unknown;
    reviewer_note: string | null;
  } = { field_name: fieldName, decision, reviewer_note: reviewerNote };

  if (decision === "edit") {
    const reviewedValueRaw = formData.get("reviewed_value");
    let parsed: unknown = null;
    if (typeof reviewedValueRaw === "string" && reviewedValueRaw.trim().length > 0) {
      try {
        parsed = JSON.parse(reviewedValueRaw);
      } catch {
        // Treat un-parseable as a plain string.
        parsed = reviewedValueRaw;
      }
    }
    decisionInput.reviewed_value = parsed;
  }

  await recordVendorAssuranceReviewDecisions(token, extractionId, [decisionInput]);
  revalidatePath(`/vendor-assurance/${documentId}`);
}

async function finalizeAction(formData: FormData): Promise<void> {
  "use server";
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return;
  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) return;
  await finalizeVendorAssuranceDocument(token, documentId);
  revalidatePath(`/vendor-assurance/${documentId}`);
}

export default async function VendorAssuranceReviewPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const { documentId } = await params;

  const [document, extractionResp]: [
    VendorAssuranceDocument | null,
    VendorAssuranceExtractionResponse | null
  ] = await Promise.all([
    getVendorAssuranceDocument(token, documentId),
    getVendorAssuranceExtraction(token, documentId),
  ]);

  if (!document) {
    return (
      <main style={{ padding: 32, color: "#e5e7eb" }}>
        <h1>Document not found</h1>
        <Link href="/vendor-assurance/queue" style={{ color: "#93c5fd" }}>← Back to queue</Link>
      </main>
    );
  }

  const isFinalized = document.processing_status === "finalized";
  const isFailed = document.processing_status === "extraction_failed";
  const isExtracted = document.processing_status === "extracted";
  const isInFlight = document.processing_status === "pending" || document.processing_status === "extracting";

  const extraction = extractionResp?.extraction ?? null;
  const spans = extractionResp?.spans ?? [];
  const currentDecisions = extractionResp?.current_decisions ?? {};
  const materialFieldNames = extractionResp?.material_field_names ?? [];

  const spansByField = new Map<string, VendorAssuranceExtractionSpan[]>();
  for (const s of spans) {
    const list = spansByField.get(s.field_name) ?? [];
    list.push(s);
    spansByField.set(s.field_name, list);
  }

  const decidedCount = materialFieldNames.filter((n) => currentDecisions[n]).length;
  const totalCount = materialFieldNames.length;
  const ready = decidedCount === totalCount && isExtracted;

  return (
    <main style={{ padding: "32px", maxWidth: 1400, margin: "0 auto", color: "#e5e7eb" }}>
      <Link href="/vendor-assurance/queue" style={{ color: "#93c5fd", fontSize: 13 }}>← Queue</Link>

      <header style={{ marginTop: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{document.original_filename}</h1>
        <p style={{ color: "#9ca3af", marginTop: 6, fontSize: 13 }}>
          Vendor: <Link href={`/vendors/${document.vendor_id}`} style={{ color: "#93c5fd" }}>{document.vendor_id.slice(0, 8)}…</Link>
          {" · "}Status: {document.processing_status}
          {" · "}Uploaded: {new Date(document.created_at).toLocaleString()}
        </p>
      </header>

      {isFailed && document.processing_error_code && (
        <section style={{
          marginBottom: 24, padding: 16, border: "1px solid #b91c1c",
          borderRadius: 8, background: "rgba(127,29,29,0.15)"
        }}>
          <strong>Extraction failed: {document.processing_error_code}</strong>
          <p style={{ marginTop: 6, color: "#fca5a5", fontSize: 13 }}>
            {ERROR_MESSAGES[document.processing_error_code] ?? document.processing_error_detail ?? ""}
          </p>
        </section>
      )}

      {isInFlight && (
        <section style={{ marginBottom: 24, padding: 16, border: "1px solid #374151", borderRadius: 8 }}>
          Extraction in progress. Refresh to check status.
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Original PDF</h2>
          <embed
            src={getVendorAssuranceDocumentPdfUrl(documentId)}
            type="application/pdf"
            style={{ width: "100%", height: 800, border: "1px solid #374151", borderRadius: 8 }}
          />
        </section>

        <section>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Extracted fields {extraction ? `(${decidedCount} of ${totalCount} decided)` : ""}
          </h2>

          {!extraction && (
            <div style={{ padding: 16, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
              {isFailed
                ? "No extraction was produced for this document."
                : "Extraction not yet available."}
            </div>
          )}

          {extraction && materialFieldNames.map((fieldName) => {
            const field = extraction.fields[fieldName];
            const decision = currentDecisions[fieldName] ?? null;
            const fieldSpans = spansByField.get(fieldName) ?? [];
            const chip = field ? fmtConfidenceChip(field.confidence) : null;

            return (
              <article key={fieldName} style={{
                marginBottom: 12, padding: 16, border: "1px solid #374151", borderRadius: 8
              }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{fieldName}</strong>
                  {chip && (
                    <span style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 999,
                      background: "rgba(31,41,55,0.6)", color: chip.color
                    }}>
                      {chip.label} confidence — extracted
                    </span>
                  )}
                </header>

                <pre style={{
                  marginTop: 8, padding: 12, background: "#0b1220", borderRadius: 6,
                  fontSize: 12, color: "#e5e7eb", whiteSpace: "pre-wrap", wordBreak: "break-word"
                }}>
                  {field ? fmtValue(field.value) : "<not present>"}
                </pre>

                {fieldSpans.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", color: "#9ca3af", fontSize: 12 }}>
                      {fieldSpans.length} source span{fieldSpans.length === 1 ? "" : "s"}
                    </summary>
                    {fieldSpans.map((s) => (
                      <blockquote key={s.id} style={{
                        margin: "8px 0", padding: 8, borderLeft: "2px solid #374151",
                        color: "#9ca3af", fontSize: 12
                      }}>
                        <div style={{ fontStyle: "italic" }}>"{s.quote}"</div>
                        <div style={{ marginTop: 4, fontSize: 11 }}>
                          {s.page_number ? `page ${s.page_number} · ` : ""}
                          chars {s.char_start}–{s.char_end}
                        </div>
                      </blockquote>
                    ))}
                  </details>
                )}

                {decision && (
                  <p style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                    Current decision: <strong style={{ color: "#e5e7eb" }}>{decision.decision}</strong>
                    {decision.decided_at && ` · ${new Date(decision.decided_at).toLocaleString()}`}
                  </p>
                )}

                {extraction && !isFinalized && (
                  <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <form action={recordDecisionAction}>
                      <input type="hidden" name="extraction_id" value={extraction.id} />
                      <input type="hidden" name="document_id" value={documentId} />
                      <input type="hidden" name="field_name" value={fieldName} />
                      <input type="hidden" name="decision" value="accept" />
                      <button type="submit" style={btnPrimary}>Accept</button>
                    </form>

                    <form action={recordDecisionAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="extraction_id" value={extraction.id} />
                      <input type="hidden" name="document_id" value={documentId} />
                      <input type="hidden" name="field_name" value={fieldName} />
                      <input type="hidden" name="decision" value="edit" />
                      <input
                        type="text"
                        name="reviewed_value"
                        placeholder="Replacement value (string or JSON)"
                        style={{
                          padding: "4px 8px", borderRadius: 4, border: "1px solid #374151",
                          background: "#0b1220", color: "#e5e7eb", fontSize: 12, minWidth: 240
                        }}
                      />
                      <button type="submit" style={btnNeutral}>Edit</button>
                    </form>

                    <form action={recordDecisionAction}>
                      <input type="hidden" name="extraction_id" value={extraction.id} />
                      <input type="hidden" name="document_id" value={documentId} />
                      <input type="hidden" name="field_name" value={fieldName} />
                      <input type="hidden" name="decision" value="reject" />
                      <button type="submit" style={btnDanger}>Reject</button>
                    </form>
                  </div>
                )}
              </article>
            );
          })}

          {extraction && isExtracted && (
            <form
              action={finalizeAction}
              style={{
                position: "sticky", bottom: 0, marginTop: 16, padding: 12,
                background: "#0b1220", border: "1px solid #374151", borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}
            >
              <input type="hidden" name="document_id" value={documentId} />
              <span style={{ color: "#9ca3af", fontSize: 13 }}>
                {decidedCount} of {totalCount} fields decided
              </span>
              <button
                type="submit"
                disabled={!ready}
                style={{
                  padding: "8px 16px", borderRadius: 6,
                  background: ready ? "#3b82f6" : "#374151",
                  color: ready ? "#fff" : "#6b7280",
                  border: "none",
                  cursor: ready ? "pointer" : "not-allowed",
                  fontSize: 13
                }}
              >
                Finalize
              </button>
            </form>
          )}

          {isFinalized && (
            <div style={{
              marginTop: 16, padding: 16, border: "1px solid #166534",
              borderRadius: 8, background: "rgba(22,101,52,0.15)", color: "#86efac"
            }}>
              Finalized. Reviewed values now appear on the vendor detail page.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4, border: "none",
  background: "#16a34a", color: "#fff", fontSize: 12, cursor: "pointer"
};
const btnNeutral: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4, border: "none",
  background: "#3b82f6", color: "#fff", fontSize: 12, cursor: "pointer"
};
const btnDanger: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4, border: "none",
  background: "#b91c1c", color: "#fff", fontSize: 12, cursor: "pointer"
};
