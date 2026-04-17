"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

export type ActionResult = { ok: true } | { error: string };

export async function sendInvite(
  email: string,
  role: string
): Promise<ActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/team/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, role }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };

  if (!res.ok) {
    if (data.error === "member_already_exists")   return { error: "This person is already a team member." };
    if (data.error === "invite_already_sent")     return { error: "An invitation was already sent to this email." };
    if (data.error === "seat_limit_reached")      return { error: data.detail ?? "Seat limit reached." };
    if (data.error === "insufficient_permissions") return { error: "Only admins can send invitations." };
    return { error: data.detail ?? data.error ?? "Failed to send invitation." };
  }

  revalidatePath("/account/team");
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/team/invites/${encodeURIComponent(inviteId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to revoke invitation." };
  }

  revalidatePath("/account/team");
  return { ok: true };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/team/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };

  if (!res.ok) {
    if (data.error === "cannot_remove_yourself")  return { error: "You cannot remove yourself." };
    if (data.error === "cannot_remove_last_admin") return { error: "Cannot remove the last admin." };
    return { error: data.error ?? "Failed to remove member." };
  }

  revalidatePath("/account/team");
  return { ok: true };
}

export async function updateMemberRole(
  userId: string,
  role: string
): Promise<ActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/team/members/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };

  if (!res.ok) {
    if (data.error === "cannot_change_own_role")   return { error: "You cannot change your own role." };
    if (data.error === "cannot_demote_last_admin") return { error: "Cannot demote the last admin." };
    return { error: data.error ?? "Failed to update role." };
  }

  revalidatePath("/account/team");
  return { ok: true };
}
