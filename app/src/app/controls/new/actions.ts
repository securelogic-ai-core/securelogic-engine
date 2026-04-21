"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateControlResult = { error: string };

export async function createControl(
  formData: FormData
): Promise<CreateControlResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) return { error: "Not authenticated" };

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { error: "Control name is required" };

  const body: Record<string, string> = { name };

  const description = ((formData.get("description") as string | null) ?? "").trim();
  if (description) body["description"] = description;

  const controlType         = ((formData.get("control_type")         as string | null) ?? "").trim();
  const domain              = ((formData.get("domain")               as string | null) ?? "").trim();
  const controlFamily       = ((formData.get("control_family")       as string | null) ?? "").trim();
  const maturityLevel       = ((formData.get("maturity_level")       as string | null) ?? "").trim();
  const implementationStatus = ((formData.get("implementation_status") as string | null) ?? "").trim();

  if (controlType)          body["control_type"]          = controlType;
  if (domain)               body["domain"]                = domain;
  if (controlFamily)        body["control_family"]        = controlFamily;
  if (maturityLevel)        body["maturity_level"]        = maturityLevel;
  if (implementationStatus) body["implementation_status"] = implementationStatus;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/controls`, {
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
    if (data.error === "control_name_already_exists") {
      return { error: "A control with this name already exists" };
    }
    return { error: data.error ?? "Failed to create control" };
  }

  const data = (await res.json()) as { control: { id: string } };
  redirect(`/controls/${data.control.id}`);
}
