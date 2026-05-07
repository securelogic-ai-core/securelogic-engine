import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getRiskSettingsServer } from "@/lib/api";
import { RiskPolicyClient } from "./RiskPolicyClient";

/**
 * RR-5 — Org-level risk-policy settings page.
 *
 * Currently exposes one section: Review Cadence Policy. Future RR-N
 * sections (acceptance workflow, escalation, KRIs) will land here as
 * additional rows on the same page rather than as new tabs.
 */
export default async function RiskPolicySettingsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const settings = await getRiskSettingsServer(token);

  // Documented defaults — kept in sync with src/api/lib/riskCadence.ts
  // DEFAULT_CADENCE_BY_RATING. Used as the initial form state when
  // the engine is unreachable; the engine's GET endpoint always
  // returns four keys so this fallback is rare in practice.
  const DEFAULT_CADENCE_BY_RATING: Record<string, number> = {
    Critical: 30, High: 60, Moderate: 90, Low: 180,
  };
  const initialCadence = settings?.cadence_by_rating ?? DEFAULT_CADENCE_BY_RATING;
  const isDefault = settings?.is_default ?? true;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px" }}>
      <Link
        href="/settings/webhooks"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 500,
          color: "#94a3b8",
          textDecoration: "none",
          marginBottom: "32px",
        }}
      >
        ← Settings
      </Link>

      <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 8px" }}>
        Risk Policy
      </h1>
      <p style={{ margin: "0 0 32px", fontSize: "14px", color: "#64748b" }}>
        Org-level defaults for how risks are reviewed over time. Per-risk overrides
        on the risk detail page take precedence.
      </p>

      {/* Tab strip — replicated from /settings/risk-scale so the two
          risk-related setting pages share one navigation surface. */}
      <div style={{
        display: "flex",
        gap: "4px",
        marginBottom: "32px",
        borderBottom: "1px solid #1e2d45",
        paddingBottom: "0",
      }}>
        {[
          { label: "Webhooks",          href: "/settings/webhooks" },
          { label: "SSO",               href: "/settings/sso" },
          { label: "Risk Rating Scale", href: "/settings/risk-scale" },
          { label: "Risk Policy",       href: "/settings/risk-policy" },
        ].map(({ label, href }) => {
          const active = label === "Risk Policy";
          return (
            <Link
              key={label}
              href={href}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: active ? "#00c4b4" : "#64748b",
                textDecoration: "none",
                borderBottom: active ? "2px solid #00c4b4" : "2px solid transparent",
                marginBottom: "-1px",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <RiskPolicyClient
        initialCadence={initialCadence}
        isDefault={isDefault}
      />
    </div>
  );
}
