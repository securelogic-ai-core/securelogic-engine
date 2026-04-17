"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateObligationMappingResult = { error: string };

export async function createObligationMapping(
  obligationId: string,
  requirementId: string,
  frameworkId?: string
): Promise<CreateObligationMappingResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/obligation-mappings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ obligation_id: obligationId, requirement_id: requirementId }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (res.status === 409) {
    revalidatePath(`/obligations/${obligationId}`);
    revalidatePath("/frameworks", "layout");
    if (frameworkId) revalidatePath(`/frameworks/${frameworkId}`);
    return;
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create mapping" };
  }

  revalidatePath(`/obligations/${obligationId}`);
  revalidatePath("/frameworks", "layout");
  if (frameworkId) revalidatePath(`/frameworks/${frameworkId}`);
}
