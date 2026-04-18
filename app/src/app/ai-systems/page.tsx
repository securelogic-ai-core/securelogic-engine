import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAiSystems, getGovernanceReviews, type AiSystem } from "@/lib/api";

export default async function AiSystemsPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const [systemsData, reviewsData] = await Promise.all([
    getAiSystems(token),
    getGovernanceReviews(token),
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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>AI Systems</h1>
          <p className="text-xs mt-1" style={{ color: '#475569' }}>
            Sorted by criticality
          </p>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            AI systems under governance for this organization.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {aiSystems.length > 0 && (
            <span className="text-sm" style={{ color: '#94a3b8' }}>
              {aiSystems.length} system{aiSystems.length !== 1 ? "s" : ""}
            </span>
          )}
          <Link
            href="/ai-systems/import"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              border: "1px solid #1e293b",
              color: "#94a3b8",
              textDecoration: "none",
            }}
          >
            ↑ Import CSV
          </Link>
          <Link
            href="/ai-systems/new"
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            Add AI System
          </Link>
        </div>
      </div>

      {/* Not entitled */}
      {systemsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            AI system data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but no systems yet */}
      {systemsData !== null && aiSystems.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm mb-3" style={{ color: '#94a3b8' }}>
            No AI systems registered yet.
          </p>
          <Link
            href="/ai-systems/new"
            className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            Add AI System
          </Link>
        </div>
      )}

      {/* AI system list */}
      {aiSystems.length > 0 && (
        <div className="space-y-3">
          {aiSystems.map((system) => (
            <Link
              key={system.id}
              href={`/ai-systems/${system.id}`}
              className="block hover:border-slate-500 cursor-pointer transition-colors rounded-xl"
            >
              <AiSystemRow
                system={system}
                reviewCount={reviewCountBySystem.get(system.id) ?? 0}
              />
            </Link>
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

function StatusChip({ value }: { value: string | null }) {
  if (!value) return null;
  const style: React.CSSProperties =
    value === "production"
      ? { background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }
      : value === "decommissioned"
      ? { background: 'rgba(148,163,184,0.1)', color: '#64748b' }
      : { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={style}
    >
      {value}
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

function AiSystemRow({
  system,
  reviewCount,
}: {
  system: AiSystem;
  reviewCount: number;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: '#f1f5f9' }}>
              {system.name}
            </span>
            <CriticalityBadge value={system.criticality} />
            <StatusChip value={system.deployment_status} />
          </div>
          {system.use_case && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: '#94a3b8' }}>
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
          <span className="text-xs" style={{ color: '#94a3b8' }}>
            {reviewCount > 0
              ? `${reviewCount} review${reviewCount !== 1 ? "s" : ""}`
              : "No reviews"}
          </span>
        </div>
      </div>
    </div>
  );
}
