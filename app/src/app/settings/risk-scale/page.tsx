import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getRiskScale, getRiskScalePresets } from "@/lib/api";
import { RiskScaleClient } from "./RiskScaleClient";

export default async function RiskScaleSettingsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlement = session.entitlementLevel ?? "starter";
  const isPremium = ["premium", "platform", "team"].includes(entitlement);

  const [scale, presets] = await Promise.all([
    getRiskScale(token),
    getRiskScalePresets(token),
  ]);

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

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
          Risk Rating Scale
        </h1>
        {isPremium && (
          <span style={{
            background: "rgba(0,196,180,0.12)",
            color: "#00c4b4",
            fontSize: "12px",
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: "20px",
          }}>
            Premium Plan
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 32px", fontSize: "14px", color: "#64748b" }}>
        Choose how risk levels are labeled and colored across the platform.
        Labels apply to findings, risks, vendor assessments, and AI-generated context.
      </p>

      {/* Tab strip */}
      <div style={{
        display: "flex",
        gap: "4px",
        marginBottom: "32px",
        borderBottom: "1px solid #1e2d45",
        paddingBottom: "0",
      }}>
        {[
          { label: "Webhooks",         href: "/settings/webhooks" },
          { label: "SSO",              href: "/settings/sso" },
          { label: "Risk Rating Scale", href: "/settings/risk-scale" },
        ].map(({ label, href }) => {
          const active = label === "Risk Rating Scale";
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

      <RiskScaleClient
        initialScale={scale}
        initialPresets={presets ?? []}
        isPremium={isPremium}
      />
    </div>
  );
}
