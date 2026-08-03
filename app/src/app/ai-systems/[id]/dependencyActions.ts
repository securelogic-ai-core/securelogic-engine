"use server";

/**
 * Vendor-dependency mutations for the AI-system detail page (EG2 slice 5).
 *
 * The engine has exposed POST/DELETE /api/ai-system-vendor-dependencies since
 * the ai-system-vendor-dependencies package, but no UI ever called them — the
 * vendor page even said "Dependencies are declared on an AI system's detail
 * page" while that page only RENDERED them. The concentration-risk features
 * (reverse dependency card, enterprise graph edge, future matcher cascade)
 * were fed by an API customers could not reach.
 *
 * Same server-action pattern as the sibling vendor-review actions: session
 * token → engine fetch → revalidate the surfaces that render the edge.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type DependencyActionResult = { ok: true } | { error: string };

const ERROR_MESSAGES: Record<string, string> = {
  vendor_not_found: "That vendor no longer exists.",
  ai_system_not_found: "This AI system no longer exists.",
  dependency_role_required: "Pick the role this vendor plays.",
  invalid_dependency_role: "Pick the role this vendor plays.",
  viewer_role_forbidden: "Viewers can't change dependencies.",
};

export async function addVendorDependency(
  aiSystemId: string,
  formData: FormData
): Promise<DependencyActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const vendorId = ((formData.get("vendor_id") as string | null) ?? "").trim();
  const role = ((formData.get("dependency_role") as string | null) ?? "").trim();
  if (!vendorId) return { error: "Pick a vendor." };
  if (!role) return { error: "Pick the role this vendor plays." };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-system-vendor-dependencies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ai_system_id: aiSystemId,
        vendor_id: vendorId,
        dependency_role: role,
      }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: ERROR_MESSAGES[data.error ?? ""] ?? "Could not add the dependency" };
  }

  revalidatePath(`/ai-systems/${aiSystemId}`);
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true };
}

export async function removeVendorDependency(
  dependencyId: string,
  aiSystemId: string,
  vendorId: string
): Promise<DependencyActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/ai-system-vendor-dependencies/${encodeURIComponent(dependencyId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: ERROR_MESSAGES[data.error ?? ""] ?? "Could not remove the dependency" };
  }

  revalidatePath(`/ai-systems/${aiSystemId}`);
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true };
}
