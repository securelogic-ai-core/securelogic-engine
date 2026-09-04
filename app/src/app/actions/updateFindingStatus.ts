"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  mapFindingActionError,
  type FindingActionError,
} from "@/lib/findingClosureError";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export type UpdateFindingStatusResult = FindingActionError;

export async function updateFindingStatus(
  findingId: string,
  status: "open" | "in_progress" | "closed",
  revalidateUrl: string
): Promise<UpdateFindingStatusResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    // The engine's refusal code is a contract for integrations, not a sentence for a human.
    // Map it before it reaches the screen — this control used to render it raw.
    const data = (await res.json().catch(() => ({}))) as { error?: string; open_actions?: number };
    return mapFindingActionError(data, findingId);
  }

  revalidatePath(revalidateUrl);
}
