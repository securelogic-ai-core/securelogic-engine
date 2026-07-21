/**
 * shared.tsx — server-safe presentational pieces shared by the Enterprise Context
 * screens (goal Item 7, Phase 7A.2). No hooks, no client code — usable from both
 * Server and Client Components.
 *
 * EAR Phase 4: the cross-domain primitives (CriticalityBadge / StatusChip /
 * MetaChip / ReadFailurePanel) were PROMOTED to the design-system kit
 * (@/components/assetKit) and are re-exported here so every existing ECL
 * import keeps working. Only ECL-specific pieces remain defined in this file.
 */

import { decisionLabel, entityTypeLabel, type ReadFailureKind } from "@/lib/enterpriseContextFormat";
import { TypeChip, ReadFailurePanel as KitReadFailurePanel } from "@/components/assetKit";

export { CriticalityBadge, StatusChip, MetaChip } from "@/components/assetKit";

export function EntityTypeChip({ value }: { value: string }) {
  return <TypeChip label={entityTypeLabel(value)} />;
}

// ─── Applicability decision badge (R5) ─────────────────────────────────────────

const DECISION_BADGE_STYLES: Record<string, React.CSSProperties> = {
  affected:              { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  potentially_affected:  { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  needs_review:          { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  not_affected:          { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  unknown:               { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

export function DecisionBadge({ value }: { value: string }) {
  const style =
    DECISION_BADGE_STYLES[value] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {decisionLabel(value)}
    </span>
  );
}

/** AD-16 #4: green when the re-derived hash reproduces; red = tamper-evident. */
export function ReproducibilityBadge({ reproduces }: { reproduces: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={
        reproduces
          ? { background: "rgba(34,197,94,0.15)", color: "#86efac" }
          : { background: "rgba(239,68,68,0.15)", color: "#fca5a5" }
      }
    >
      {reproduces ? "✓ Verified — hash reproduces" : "✕ Does NOT reproduce — record may be tampered"}
    </span>
  );
}

// ─── Gate-aware failure panel ──────────────────────────────────────────────────
//
// disabled   → the feature doesn't exist for this org (flag off / route absent): neutral copy.
// capability → the org isn't granted `enterprise_context`: entitlement affordance.
// error      → plain error with the shared human copy.

export function ReadFailurePanel({
  kind,
  message,
}: {
  kind: ReadFailureKind;
  message: string;
}) {
  return (
    <KitReadFailurePanel
      kind={kind}
      message={message}
      capabilityNote="Enterprise Context is part of the Platform plans."
    />
  );
}
