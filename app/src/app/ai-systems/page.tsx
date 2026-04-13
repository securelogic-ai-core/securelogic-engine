import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAiSystems, getGovernanceReviews, type AiSystem } from "@/lib/api";

export default async function AiSystemsPage() {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const [systemsData, reviewsData] = await Promise.all([
    getAiSystems(session.apiKey),
    getGovernanceReviews(session.apiKey),
  ]);

  // Build ai_system_id → review count from the flat reviews list.
  const reviewCountBySystem = new Map<string, number>();
  for (const r of reviewsData?.reviews ?? []) {
    reviewCountBySystem.set(
      r.ai_system_id,
      (reviewCountBySystem.get(r.ai_system_id) ?? 0) + 1
    );
  }

  const aiSystems = systemsData?.ai_systems ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Systems</h1>
          <p className="text-slate-500 text-sm mt-1">
            AI systems under governance for this organization.
          </p>
        </div>
        {aiSystems.length > 0 && (
          <span className="text-sm text-slate-500">
            {aiSystems.length} system{aiSystems.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Not entitled */}
      {systemsData === null && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500">
            AI system data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but no systems yet */}
      {systemsData !== null && aiSystems.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">
            No AI systems registered. Add AI systems via the API to populate this view.
          </p>
        </div>
      )}

      {/* AI system list */}
      {aiSystems.length > 0 && (
        <div className="space-y-3">
          {aiSystems.map((system) => (
            <AiSystemRow
              key={system.id}
              system={system}
              reviewCount={reviewCountBySystem.get(system.id) ?? 0}
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

const CRITICALITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high:     "bg-orange-100 text-orange-800",
  medium:   "bg-amber-100 text-amber-800",
  low:      "bg-green-100 text-green-800",
};

function CriticalityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-slate-400">—</span>;
  const cls = CRITICALITY_STYLES[value] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}
    >
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function StatusChip({ value }: { value: string | null }) {
  if (!value) return null;
  // Colour only the clearly elevated states; everything else gets slate.
  const cls =
    value === "production"
      ? "bg-blue-100 text-blue-800"
      : value === "decommissioned"
      ? "bg-slate-200 text-slate-600"
      : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {value}
    </span>
  );
}

function MetaChip({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <span className="text-slate-400">{label}:</span>
      <span className="text-slate-700">{value}</span>
    </span>
  );
}

function AiSystemRow({
  system,
  reviewCount,
}: {
  system: AiSystem;
  reviewCount: number;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 truncate">
              {system.name}
            </span>
            <CriticalityBadge value={system.criticality} />
            <StatusChip value={system.deployment_status} />
          </div>
          {system.use_case && (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              {system.use_case}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <MetaChip label="Model"       value={system.model_type} />
            <MetaChip label="Data"        value={system.data_classification} />
            <MetaChip label="Risk class"  value={system.risk_classification} />
          </div>
        </div>

        {/* Right: review count */}
        <div className="flex-shrink-0 text-right">
          <span className="text-xs text-slate-500">
            {reviewCount > 0
              ? `${reviewCount} review${reviewCount !== 1 ? "s" : ""}`
              : "No reviews"}
          </span>
        </div>
      </div>
    </div>
  );
}
