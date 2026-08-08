import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOrgSettings } from "@/lib/api";
import OrganizationSettingsClient from "./OrganizationSettingsClient";

/**
 * /settings/organization — organization profile administration.
 *
 * Name is the org's display identity (team invites, briefs, reports). The
 * risk-context fields (regulated / handles PII / safety-critical / scale)
 * drive context-weighted risk scoring, finding enterprise context, and
 * posture computation — until this page existed they were operator-only, so
 * customer orgs sat at defaults and the weighting never applied.
 */
export default async function OrganizationSettingsPage() {
  const session = await getSession();
  const token   = session.jwtToken ?? null;

  if (!token) redirect("/login");

  const role = session.userRole ?? "viewer";
  if (role !== "admin") redirect("/settings/risk-scale");

  const settings = await getOrgSettings(token);

  return (
    <div style={{ maxWidth: "672px", margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 6px" }}>
          Organization
        </h1>
        <p style={{ color: "#64748b", margin: 0 }}>
          Your organization&apos;s identity and risk context. The risk context
          calibrates how SecureLogic scores and prioritizes findings for you.
        </p>
      </div>

      {settings ? (
        <OrganizationSettingsClient
          name={settings.name}
          regulated={settings.regulated ?? false}
          handlesPii={settings.handles_pii ?? false}
          safetyCritical={settings.safety_critical ?? false}
          scale={settings.scale ?? "Small"}
        />
      ) : (
        <p style={{ color: "#f87171", fontSize: 14 }}>
          Could not load organization settings. Refresh to try again.
        </p>
      )}
    </div>
  );
}
