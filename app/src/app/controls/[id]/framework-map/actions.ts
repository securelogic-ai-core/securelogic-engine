"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export type CreateControlMappingResult = { error: string };

export async function createControlMapping(
  controlId: string,
  requirementId: string,
  frameworkId?: string
): Promise<CreateControlMappingResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/control-mappings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ control_id: controlId, requirement_id: requirementId }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (res.status === 409) {
    revalidatePath(`/controls/${controlId}`);
    revalidatePath("/frameworks", "layout");
    if (frameworkId) revalidatePath(`/frameworks/${frameworkId}`);
    return;
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create mapping" };
  }

  revalidatePath(`/controls/${controlId}`);
  revalidatePath("/frameworks", "layout");
  if (frameworkId) revalidatePath(`/frameworks/${frameworkId}`);
}
