"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export type ActivateFrameworkResult = { error: string };

export async function activateFramework(
  templateKey: string
): Promise<ActivateFrameworkResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/frameworks/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ template_key: templateKey }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to activate framework" };
  }

  revalidatePath("/frameworks");
  redirect("/frameworks");
}

export type DeactivateFrameworkResult = { error: string };

export async function deactivateFramework(
  frameworkId: string
): Promise<DeactivateFrameworkResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/frameworks/${frameworkId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to deactivate framework" };
  }

  revalidatePath("/frameworks");
  redirect("/frameworks");
}

/* =========================================================
   VA-6 — questionnaire content layer actions.
   ========================================================= */

export type CurateRequirementResult = { error: string };

/** Curate a requirement's content (guidance and/or scope tags). Content only —
 *  identity (reference_id, title) is immutable by engine contract. Admin-gated
 *  server-side; the engine validates tags against the closed vocabulary. */
export async function curateRequirement(
  requirementId: string,
  patch: { description?: string | null; scope_tags?: string[] },
  frameworkId: string
): Promise<CurateRequirementResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/requirements/${encodeURIComponent(requirementId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    return { error: data.detail ?? data.error ?? "Failed to save curation" };
  }

  revalidatePath(`/frameworks/${frameworkId}`);
}

export type CreateRequirementResult = { error: string };

/** Add a custom question to a framework the org owns. The engine derives
 *  heuristic scope tags at creation so the question is visible to vendor
 *  questionnaire scoping from birth. */
export async function createRequirement(input: {
  framework_id: string;
  reference_id: string;
  title: string;
  description?: string;
}): Promise<CreateRequirementResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/requirements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    return { error: data.detail ?? data.error ?? "Failed to add question" };
  }

  revalidatePath(`/frameworks/${input.framework_id}`);
}
