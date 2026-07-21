/**
 * shared.tsx — presentational building blocks for the Executive Risk dashboard.
 * Server-renderable (no client state); the interactive charts are separate
 * "use client" components. Styling matches the app's dark brand theme.
 */

import type { ReactNode } from "react";
import {
  riskBandMeta,
  healthBandMeta,
  type ConnectorHealthBand,
} from "@/lib/executiveRisk";

export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs" style={{ color: "#64748b" }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A risk-band pill for a 0–100 score. */
export function RiskBadge({ score }: { score: number }) {
  const meta = riskBandMeta(score);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: `${meta.color}22`, color: meta.text, border: `1px solid ${meta.color}55` }}
    >
      {meta.label}
    </span>
  );
}

/** A connector health-band pill. */
export function HealthBadge({ band }: { band: ConnectorHealthBand }) {
  const meta = healthBandMeta(band);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: `${meta.color}22`, color: meta.text, border: `1px solid ${meta.color}55` }}
    >
      {meta.label}
    </span>
  );
}

/** Shown when a panel's engine feature is dark (404) — informational, not an error. */
export function DisabledNotice({ feature }: { feature: string }) {
  return (
    <div className="rounded-lg border border-dashed border-brand-line px-4 py-6 text-center">
      <p className="text-xs" style={{ color: "#64748b" }}>
        {feature} is not enabled for your organization yet.
      </p>
    </div>
  );
}

/** Shown when a panel's fetch failed for a real reason. */
export function PanelError({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-brand-line px-4 py-6 text-center" style={{ background: "rgba(220,38,38,0.06)" }}>
      <p className="text-xs" style={{ color: "#fca5a5" }}>
        Could not load this panel ({error}).
      </p>
    </div>
  );
}

/** Neutral empty state (feature on, no data yet). */
export function EmptyNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-brand-line px-4 py-6 text-center">
      <p className="text-xs" style={{ color: "#64748b" }}>
        {message}
      </p>
    </div>
  );
}
