import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getVendors, getVendorAssessments, type Vendor } from "@/lib/api";

export default async function VendorsPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const [vendorsData, assessmentsData] = await Promise.all([
    getVendors(token, "active"),
    getVendorAssessments(token),
  ]);

  // Build vendor_id → assessment count map from the flat assessments list.
  const assessmentCountByVendor = new Map<string, number>();
  for (const a of assessmentsData?.assessments ?? []) {
    assessmentCountByVendor.set(
      a.vendor_id,
      (assessmentCountByVendor.get(a.vendor_id) ?? 0) + 1
    );
  }

  const vendors = vendorsData?.vendors ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>Vendors</h1>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            Third-party vendors tracked for this organization.
          </p>
        </div>
        {vendors.length > 0 && (
          <span className="text-sm" style={{ color: '#94a3b8' }}>
            {vendors.length} active
          </span>
        )}
      </div>

      {/* Not entitled — both calls returned null */}
      {vendorsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Vendor data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but no vendors yet */}
      {vendorsData !== null && vendors.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            No active vendors. Add vendors via the API to populate this view.
          </p>
        </div>
      )}

      {/* Vendor list */}
      {vendors.length > 0 && (
        <div className="space-y-3">
          {vendors.map((vendor) => (
            <VendorRow
              key={vendor.id}
              vendor={vendor}
              assessmentCount={assessmentCountByVendor.get(vendor.id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const CRITICALITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: 'rgba(239,68,68,0.15)',   color: '#fca5a5' },
  high:     { background: 'rgba(249,115,22,0.15)',  color: '#fdba74' },
  medium:   { background: 'rgba(245,158,11,0.15)',  color: '#fcd34d' },
  low:      { background: 'rgba(34,197,94,0.15)',   color: '#86efac' },
};

function CriticalityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs" style={{ color: '#475569' }}>—</span>;
  const style = CRITICALITY_BADGE_STYLES[value] ?? { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function MetaChip({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span style={{ color: '#94a3b8' }}>{label}:</span>
      <span style={{ color: '#cbd5e1' }}>{value}</span>
    </span>
  );
}

function VendorRow({
  vendor,
  assessmentCount,
}: {
  vendor: Vendor;
  assessmentCount: number;
}) {
  const lastReviewed = vendor.last_reviewed_at
    ? new Date(vendor.last_reviewed_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: '#f1f5f9' }}>
              {vendor.name}
            </span>
            <CriticalityBadge value={vendor.criticality} />
          </div>
          {vendor.service_description && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: '#94a3b8' }}>
              {vendor.service_description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <MetaChip label="Category"    value={vendor.category} />
            <MetaChip label="Data"        value={vendor.data_sensitivity} />
            <MetaChip label="Access"      value={vendor.access_level} />
            {vendor.website && (
              <span className="text-xs truncate max-w-xs" style={{ color: '#475569' }}>
                {vendor.website}
              </span>
            )}
          </div>
        </div>

        {/* Right: assessment count + last reviewed */}
        <div className="flex-shrink-0 text-right space-y-1">
          <div>
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              {assessmentCount > 0
                ? `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
                : "No assessments"}
            </span>
          </div>
          {lastReviewed && (
            <div>
              <span className="text-xs" style={{ color: '#475569' }}>
                Reviewed {lastReviewed}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
