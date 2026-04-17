import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getTeamMembers, getAuthMe } from "@/lib/api";
import TeamManagement from "./TeamManagement";

export default async function TeamPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const [teamData, me] = await Promise.all([
    getTeamMembers(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : null,
  ]);

  // Team management requires at least a platform tier
  const entitlement = me?.entitlementLevel ?? session.entitlementLevel ?? "starter";
  const isPlatform  = entitlement !== "starter";

  if (!isPlatform) {
    redirect("/account");
  }

  if (!teamData) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-slate-500 text-sm">Failed to load team data. Please try again.</p>
      </div>
    );
  }

  const currentUserId   = me?.id ?? session.userId ?? "";
  const currentUserRole = me?.role ?? session.userRole ?? "admin";
  const isAdmin         = currentUserRole === "admin";

  return (
    <TeamManagement
      members={teamData.members}
      pendingInvites={teamData.pending_invites}
      seatUsage={teamData.seat_usage}
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
      isAdmin={isAdmin}
    />
  );
}
