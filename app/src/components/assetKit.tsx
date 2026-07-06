/**
 * assetKit.tsx — the cross-domain asset UI kit (EAR Phase 4).
 *
 * Promotion of the ECL screens' shared presentational pieces
 * (app/src/app/enterprise-context/shared.tsx) into a design-system home usable
 * by EVERY asset-bearing surface — vendors, AI systems, enterprise context,
 * and the unified /assets page — converging the per-page duplicate badge/chip
 * implementations (ARCHITECTURE.md §3.4 "ECL UI kit → design system").
 *
 * Server-safe: no hooks, no client code — usable from both Server and Client
 * Components. Domain-specific pieces (EntityTypeChip, DecisionBadge, the
 * ai-systems deployment StatusChip) stay with their domains; only the
 * genuinely cross-domain primitives live here.
 */

import Link from "next/link";

// ─── Badges / chips ────────────────────────────────────────────────────────────

const CRITICALITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: "rgba(239,68,68,0.15)",  color: "#fca5a5" },
  high:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  medium:   { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

export function CriticalityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs" style={{ color: "#475569" }}>—</span>;
  const style =
    CRITICALITY_BADGE_STYLES[value] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

/** Lifecycle status chip — silent for the default 'active' state. */
export function StatusChip({ value }: { value: string | null }) {
  if (!value || value === "active") return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
    >
      {value}
    </span>
  );
}

export function MetaChip({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span style={{ color: "#94a3b8" }}>{label}:</span>
      <span style={{ color: "#cbd5e1" }}>{value}</span>
    </span>
  );
}

/** Generic type chip (asset types, entity types — caller supplies the label). */
export function TypeChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd" }}
    >
      {label}
    </span>
  );
}

// ─── Gate-aware failure panel ──────────────────────────────────────────────────
//
// disabled   → the feature doesn't exist for this org (flag off / route absent): neutral copy.
// capability → the org isn't granted the capability: entitlement affordance.
// error      → plain error with the shared human copy.

export type ReadFailurePanelKind = "disabled" | "capability" | "error";

export function ReadFailurePanel({
  kind,
  message,
  capabilityNote = "This feature is part of the Platform plans.",
}: {
  kind: ReadFailurePanelKind;
  message: string;
  /** First sentence of the capability affordance (domain names its feature). */
  capabilityNote?: string;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
      <p className="text-sm mb-1" style={{ color: "#94a3b8" }}>{message}</p>
      {kind === "capability" && (
        <p className="text-xs mt-2" style={{ color: "#64748b" }}>
          {capabilityNote} Ask your administrator, or{" "}
          <Link href="/pricing" className="underline hover:opacity-80" style={{ color: "#94a3b8" }}>
            see plans
          </Link>
          .
        </p>
      )}
      {kind === "disabled" && (
        <p className="text-xs mt-2" style={{ color: "#64748b" }}>
          Contact your administrator if you believe this is an error.
        </p>
      )}
    </div>
  );
}
