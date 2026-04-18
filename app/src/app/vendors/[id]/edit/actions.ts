"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type VendorEditData = {
  name: string;
  category?: string | null;
  criticality?: string | null;
  data_sensitivity?: string | null;
  access_level?: string | null;
  service_description?: string | null;
  website?: string | null;
};

export async function updateVendorAction(
  vendorId: string,
  data: VendorEditData
): Promise<{ error: string } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const body: Record<string, string | null> = { name: data.name };
  body.category           = data.category           ?? null;
  body.criticality        = data.criticality        ?? null;
  body.data_sensitivity   = data.data_sensitivity   ?? null;
  body.access_level       = data.access_level       ?? null;
  body.service_description = data.service_description ?? null;
  body.website            = data.website            ?? null;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/vendors/${vendorId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect(`/vendors/${vendorId}`);
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { error: json.detail ?? json.error ?? "Failed to update vendor" };
}
