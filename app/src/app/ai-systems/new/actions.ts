"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateAiSystemResult = { error: string };

export async function createAiSystem(
  formData: FormData
): Promise<CreateAiSystemResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) return { error: "Not authenticated" };

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { error: "AI system name is required" };

  const body: Record<string, string> = { name };

  const optionals: Array<[string, string | null]> = [
    ["use_case",            formData.get("use_case") as string | null],
    ["model_type",          formData.get("model_type") as string | null],
    ["criticality",         formData.get("criticality") as string | null],
    ["deployment_status",   formData.get("deployment_status") as string | null],
    ["data_classification", formData.get("data_classification") as string | null],
    ["risk_classification", formData.get("risk_classification") as string | null],
  ];

  for (const [key, val] of optionals) {
    if (val?.trim()) body[key] = val.trim();
  }

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-systems`, {
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
    if (data.error === "ai_system_name_already_exists") {
      return { error: "An AI system with this name already exists" };
    }
    return { error: data.error ?? "Failed to create AI system" };
  }

  const data = (await res.json()) as { ai_system: { id: string } };
  redirect(`/ai-systems/${data.ai_system.id}`);
}
