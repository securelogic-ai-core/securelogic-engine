"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  mapFindingActionError,
  type FindingActionError,
} from "@/lib/findingClosureError";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type UpdateFindingStatusResult = FindingActionError;

export async function updateFindingStatus(
  vendorId: string,
  findingId: string,
  status: "open" | "in_progress" | "closed"
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
    // Map it through the one shared mapper every other close surface uses, so this card can
    // never render the raw `close_requires_remediation_complete` code to a customer.
    const data = (await res.json().catch(() => ({}))) as { error?: string; open_actions?: number };
    return mapFindingActionError(data, findingId);
  }

  revalidatePath(`/vendors/${vendorId}`);
}
