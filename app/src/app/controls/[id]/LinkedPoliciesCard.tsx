import Link from "next/link";
import type { Policy } from "@/lib/api";

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  draft:        { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  active:       { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  under_review: { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  retired:      { background: "rgba(100,116,139,0.1)",  color: "#64748b" },
};

const STATUS_LABELS: Record<string, string> = {
  draft:        "Draft",
  active:       "Active",
  under_review: "Under Review",
  retired:      "Retired",
};

function PolicyStatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold" style={style}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

interface Props {
  policies: Policy[];
  controlId: string;
}

export function LinkedPoliciesCard({ policies, controlId: _controlId }: Props) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Linked Policies
      </h3>

      {policies.length === 0 ? (
        <div>
          <p className="text-xs mb-2" style={{ color: "#475569" }}>
            No policies linked
          </p>
          <Link
            href="/policies"
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "#00c4b4" }}
          >
            Browse policies →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {policies.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <Link
                href={`/policies/${p.id}`}
                className="text-xs font-medium transition-colors hover:opacity-80 truncate"
                style={{ color: "#cbd5e1" }}
              >
                {p.name}
              </Link>
              <PolicyStatusBadge status={p.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
