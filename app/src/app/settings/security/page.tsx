import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOrgSettings, getTeamMembers } from "@/lib/api";
import SecuritySettingsClient from "./SecuritySettingsClient";

export default async function SecuritySettingsPage() {
  const session = await getSession();
  const token   = session.jwtToken ?? null;

  if (!token) redirect("/login");

  const role = session.userRole ?? "viewer";
  if (role !== "admin") redirect("/settings/risk-scale");

  const [orgSettings, teamData] = await Promise.all([
    getOrgSettings(token),
    getTeamMembers(token),
  ]);

  const requireMfa   = orgSettings?.require_mfa ?? false;
  const members      = teamData?.members ?? [];
  const memberCount  = members.filter(m => m.status === "active").length;
  const mfaCount     = members.filter(m => m.status === "active" && m.totp_enabled).length;

  return (
    <div style={{ maxWidth: "672px", margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 6px" }}>
          Security
        </h1>
        <p style={{ color: "#64748b", margin: 0 }}>
          Organisation-wide authentication policy.
        </p>
      </div>

      <SecuritySettingsClient
        requireMfa={requireMfa}
        mfaCount={mfaCount}
        memberCount={memberCount}
      />
    </div>
  );
}
