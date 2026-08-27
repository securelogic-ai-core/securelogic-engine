"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { penTestEnabled } from "@/lib/penTestFeatureFlag";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreatePenTestResult = { error: string };

/**
 * Create a pen-test engagement (PEN-1). Same server-action shape as
 * createVendor: validate the one required field here for an immediate error,
 * let the engine own everything else (date format, period ordering, length
 * caps), and translate its error codes into sentences a customer can act on.
 */
export async function createPenTest(
  formData: FormData
): Promise<CreatePenTestResult | void> {
  // A server action is its own endpoint: Next.js will invoke it from a direct
  // POST carrying the action id, without ever rendering the page whose
  // notFound() gate would have stopped a browser. So the flag is re-checked
  // HERE rather than trusted from the page — the page gate and this one close
  // different doors. The engine 404s the create route underneath as the final
  // backstop; this just refuses before spending a network call, and keeps the
  // action's contract (a returned error, never a thrown one).
  if (!penTestEnabled()) return { error: "Not available" };

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) return { error: "Not authenticated" };

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { error: "Engagement name is required" };

  const body: Record<string, string> = { name };

  const optionals: Array<[string, string | null]> = [
    ["provider",         formData.get("provider") as string | null],
    ["started_on",       formData.get("started_on") as string | null],
    ["ended_on",         formData.get("ended_on") as string | null],
    ["report_reference", formData.get("report_reference") as string | null],
  ];

  for (const [key, val] of optionals) {
    if (val?.trim()) body[key] = val.trim();
  }

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/pen-test-engagements`, {
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
    // The engine's period check mirrors the column CHECK — surface it as a
    // sentence rather than a code so the fix is obvious from the form.
    if (data.error === "invalid_period") {
      return { error: "The end date is before the start date" };
    }
    if (data.error === "invalid_date") {
      return { error: "Dates must be valid calendar dates (YYYY-MM-DD)" };
    }
    return { error: data.error ?? "Failed to record pen test" };
  }

  const data = (await res.json()) as { engagement: { id: string } };
  redirect(`/pen-tests/${data.engagement.id}`);
}
