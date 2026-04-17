"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateObligationResult = { error: string };

export async function createObligation(
  formData: FormData
): Promise<CreateObligationResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) return { error: "Not authenticated" };

  const title = ((formData.get("title") as string | null) ?? "").trim();
  if (!title) return { error: "Obligation title is required" };

  const body: Record<string, string> = { title };

  const optionals: Array<[string, string | null]> = [
    ["description",        formData.get("description") as string | null],
    ["source_regulation",  formData.get("source_regulation") as string | null],
    ["domain",             formData.get("domain") as string | null],
    ["priority",           formData.get("priority") as string | null],
    ["due_date",           formData.get("due_date") as string | null],
    ["notes",              formData.get("notes") as string | null],
  ];

  for (const [key, val] of optionals) {
    if (val?.trim()) body[key] = val.trim();
  }

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/obligations`, {
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
    if (data.error === "obligation_title_already_exists") {
      return { error: "An obligation with this title already exists" };
    }
    return { error: data.error ?? "Failed to create obligation" };
  }

  const data = (await res.json()) as { obligation: { id: string } };
  redirect(`/obligations/${data.obligation.id}`);
}
