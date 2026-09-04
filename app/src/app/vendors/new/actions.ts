"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateVendorResult = { error: string };

export async function createVendor(
  formData: FormData
): Promise<CreateVendorResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) return { error: "Not authenticated" };

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { error: "Vendor name is required" };

  const body: Record<string, string> = { name };

  const optionals: Array<[string, string | null]> = [
    ["category",            formData.get("category") as string | null],
    ["service_description", formData.get("service_description") as string | null],
    ["data_sensitivity",    formData.get("data_sensitivity") as string | null],
    ["access_level",        formData.get("access_level") as string | null],
    ["website",             formData.get("website") as string | null],
  ];

  for (const [key, val] of optionals) {
    if (val?.trim()) body[key] = val.trim();
  }

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/vendors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error === "vendor_name_already_exists") {
      return { error: "A vendor with this name already exists" };
    }
    return { error: data.error ?? "Failed to create vendor" };
  }

  const data = (await res.json()) as { vendor: { id: string } };

  // Vendor Onboarding 2.0: the common one-vendor/one-service case gets its
  // primary relationship created for it, named after the vendor. Criticality
  // is no longer asked here — it is DERIVED from the relationship's factual
  // intake, which the vendor page now prompts for. Best-effort and silent on
  // failure: where Vendor Assurance is dark the route answers 404, and the
  // vendor itself is already created either way.
  try {
    await fetch(`${ENGINE_URL}/api/vendors/${encodeURIComponent(data.vendor.id)}/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `${name} — primary service`, ...(body.service_description ? { service_description: body.service_description } : {}) }),
      cache: "no-store",
    });
  } catch {
    /* the vendor exists; the relationship can be added from its page */
  }

  redirect(`/vendors/${data.vendor.id}`);
}
