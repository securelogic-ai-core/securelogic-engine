import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  listVendorAssuranceDocuments,
  type VendorAssuranceDocument,
  type VendorAssuranceProcessingStatus,
} from "@/lib/api";

const STATUSES: readonly VendorAssuranceProcessingStatus[] = [
  "pending",
  "extracting",
  "extracted",
  "manual_review_requested",
  "approved",
  "rejected",
  "extraction_failed",
  "finalized",
];

const STATUS_LABEL: Record<VendorAssuranceProcessingStatus, string> = {
  pending:                 "Pending",
  extracting:              "Extracting",
  extracted:               "Extracted",
  manual_review_requested: "Manual review requested",
  approved:                "Approved",
  rejected:                "Rejected",
  extraction_failed:       "Extraction failed",
  finalized:               "Finalized (legacy)",
};

function isStatus(v: string | undefined): v is VendorAssuranceProcessingStatus {
  return v !== undefined && (STATUSES as readonly string[]).includes(v);
}

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function VendorAssuranceQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  const statusFilter = isStatus(sp.status) ? sp.status : undefined;
  const vendorIdFilter = typeof sp.vendor_id === "string" && sp.vendor_id.length > 0 ? sp.vendor_id : undefined;

  const data = await listVendorAssuranceDocuments(token, {
    ...(statusFilter !== undefined ? { status: statusFilter } : {}),
    ...(vendorIdFilter !== undefined ? { vendorId: vendorIdFilter } : {}),
    limit: 100,
  });
  const documents: VendorAssuranceDocument[] = data?.documents ?? [];

  const hasFilters = statusFilter !== undefined || vendorIdFilter !== undefined;

  return (
    <main style={{ padding: "32px", maxWidth: 1200, margin: "0 auto", color: "#e5e7eb" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Vendor Assurance — Review Queue</h1>
        <p style={{ color: "#9ca3af", marginTop: 8 }}>
          SOC reports uploaded for vendor-assurance extraction. Open a document to review the cover sheet,
          complementary user entity controls, and exceptions against the source PDF, correct any extracted
          field inline, then approve, request manual review, or reject the extraction.
        </p>
      </header>

      <section style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {STATUSES.map((s) => {
          const active = statusFilter === s;
          const href = `/vendor-assurance/queue?status=${encodeURIComponent(s)}${
            vendorIdFilter ? `&vendor_id=${encodeURIComponent(vendorIdFilter)}` : ""
          }`;
          return (
            <Link
              key={s}
              href={href}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid #374151",
                background: active ? "rgba(59,130,246,0.2)" : "transparent",
                color: active ? "#93c5fd" : "#9ca3af",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              {STATUS_LABEL[s]}
            </Link>
          );
        })}
        {hasFilters && (
          <Link
            href="/vendor-assurance/queue"
            style={{ padding: "6px 12px", color: "#9ca3af", fontSize: 13 }}
          >
            Clear filters
          </Link>
        )}
      </section>

      {documents.length === 0 && !hasFilters && (
        <div style={{ padding: 24, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          No assurance documents uploaded yet. Upload a SOC report from the vendor detail page to get started.
        </div>
      )}

      {documents.length === 0 && hasFilters && (
        <div style={{ padding: 24, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          No documents match the current filters.
        </div>
      )}

      {documents.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #374151" }}>
              <th style={{ padding: "8px 12px" }}>Filename</th>
              <th style={{ padding: "8px 12px" }}>Vendor</th>
              <th style={{ padding: "8px 12px" }}>Type hint</th>
              <th style={{ padding: "8px 12px" }}>Uploaded</th>
              <th style={{ padding: "8px 12px" }}>Status</th>
              <th style={{ padding: "8px 12px" }}></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "10px 12px" }}>{d.original_filename}</td>
                <td style={{ padding: "10px 12px", color: "#9ca3af" }}>
                  <Link href={`/vendors/${d.vendor_id}`} style={{ color: "#93c5fd" }}>
                    {d.vendor_id.slice(0, 8)}…
                  </Link>
                </td>
                <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{d.document_type_hint ?? "—"}</td>
                <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{fmt(d.created_at)}</td>
                <td style={{ padding: "10px 12px" }}>{STATUS_LABEL[d.processing_status]}</td>
                <td style={{ padding: "10px 12px" }}>
                  <Link href={`/vendor-assurance/${d.id}`} style={{ color: "#93c5fd" }}>
                    Review →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
