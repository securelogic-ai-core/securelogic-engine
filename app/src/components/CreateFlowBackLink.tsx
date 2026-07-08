import Link from "next/link";

/**
 * CreateFlowBackLink — the single back/breadcrumb link shared by the per-type
 * Create screens that the Asset Registry federates to (Vendors, AI Systems).
 *
 * It exists so those dedicated flows present IDENTICAL breadcrumb behavior with
 * no duplicated markup: each server page decides the destination (its own list
 * by default, or "Assets" when opened from the registry via ?from=registry) and
 * passes it here. Styling matches the ECL/registry back-links (small muted
 * "← {label}" affordance).
 */
export function CreateFlowBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
      style={{ color: "#94a3b8" }}
    >
      ← {label}
    </Link>
  );
}
