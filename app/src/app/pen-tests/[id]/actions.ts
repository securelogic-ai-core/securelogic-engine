"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export type PenTestActionResult = { error?: string };

/**
 * Update an engagement's lifecycle + descriptive fields (T2-I). Same
 * server-action shape as createPenTest: minimal validation here (the select
 * and date inputs already constrain the values), the engine owns the
 * vocabulary checks and the closed<=>closed_at stamping, and its error codes
 * come back as sentences a customer can act on.
 */
export async function updatePenTestEngagement(
  engagementId: string,
  formData: FormData
): Promise<PenTestActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  // Empty string from a cleared input means "clear the field" — the engine
  // takes null for that; omitted keys are left untouched.
  const body: Record<string, unknown> = {};
  const fields = ["status", "test_type", "methodology", "scope_summary", "next_test_due"] as const;
  for (const key of fields) {
    const val = formData.get(key);
    if (val === null) continue; // field not in the form at all
    const trimmed = (val as string).trim();
    body[key] = trimmed === "" ? null : trimmed;
  }
  // status is never clearable — an engagement is always somewhere.
  if (body["status"] === null) delete body["status"];

  if (Object.keys(body).length === 0) return { error: "Nothing to update" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/pen-test-engagements/${engagementId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error === "invalid_status") {
      return { error: "That is not one of the five engagement statuses" };
    }
    if (data.error === "invalid_test_type") {
      return { error: "That is not a recognized test type" };
    }
    if (data.error === "next_test_due_must_be_iso_date_or_null") {
      return { error: "Next test due must be a valid calendar date (YYYY-MM-DD)" };
    }
    return { error: data.error ?? "Failed to update the engagement" };
  }

  revalidatePath(`/pen-tests/${engagementId}`);
  revalidatePath("/pen-tests");
  return {};
}

/**
 * Record one retest act on a pen-test finding (T2-I). Append-only on the
 * engine, and a 'remediated' result NEVER closes the finding — the platform's
 * closure gate is the only closure path, so nothing here touches finding
 * state. The notes requirement mirrors the engine's named 400: a retest that
 * leaves the exposure open must say what the tester found.
 */
export async function recordRetest(
  engagementId: string,
  findingId: string,
  formData: FormData
): Promise<PenTestActionResult> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const result = ((formData.get("result") as string | null) ?? "").trim();
  if (!result) return { error: "Pick a retest result" };

  const notes = ((formData.get("notes") as string | null) ?? "").trim();
  // Mirror the engine's notes_required check for an immediate error — the
  // engine still enforces it (CHECK constraint + named 400) either way.
  if (result !== "remediated" && !notes) {
    return {
      error:
        "A retest that leaves the exposure open must say what the tester found",
    };
  }

  const body: Record<string, string> = { result };
  if (notes) body["notes"] = notes;
  const performedOn = ((formData.get("performed_on") as string | null) ?? "").trim();
  if (performedOn) body["performed_on"] = performedOn;

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/pen-test-engagements/${engagementId}/findings/${findingId}/retests`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error === "notes_required") {
      return {
        error:
          "A retest that leaves the exposure open must say what the tester found",
      };
    }
    if (data.error === "invalid_result") {
      return { error: "That is not a recognized retest result" };
    }
    if (data.error === "pen_test_finding_not_found") {
      return { error: "That finding is not a pen-test finding of this organization" };
    }
    if (data.error === "performed_on_must_be_iso_date") {
      return { error: "Performed on must be a valid calendar date (YYYY-MM-DD)" };
    }
    return { error: data.error ?? "Failed to record the retest" };
  }

  // The verification history renders on the finding detail; refresh both.
  revalidatePath(`/pen-tests/${engagementId}`);
  revalidatePath(`/findings/${findingId}`);
  return {};
}
