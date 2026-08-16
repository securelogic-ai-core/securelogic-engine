"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { legacyVendorWritesEnabled } from "@/lib/legacyVendorWrites";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateAssessmentResult = { error: string };

export async function createAssessment(
  vendorId: string,
  formData: FormData
): Promise<CreateAssessmentResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  // B1 demotion: refuse before the engine does (it would 410), with the
  // same pointer the retired pages show.
  if (!legacyVendorWritesEnabled()) {
    return {
      error:
        "Point-in-time assessments have been retired — open a vendor engagement instead.",
    };
  }

  const assessment_type = ((formData.get("assessment_type") as string | null) ?? "").trim();
  if (!assessment_type) return { error: "Assessment type is required" };

  const overall_severity = ((formData.get("overall_severity") as string | null) ?? "").trim();
  if (!overall_severity) return { error: "Overall severity is required" };

  let importedFindings: unknown[] = [];
  const importedFindingsJson = ((formData.get("imported_findings_json") as string | null) ?? "").trim();
  if (importedFindingsJson) {
    try {
      const parsed = JSON.parse(importedFindingsJson);
      if (Array.isArray(parsed)) importedFindings = parsed;
    } catch {
      // ignore malformed JSON — findings are additive, not critical
    }
  }

  const body: Record<string, unknown> = {
    vendor_id: vendorId,
    assessment_type,
    overall_severity,
    summary: ((formData.get("summary") as string | null) ?? "").trim() || null,
    notes: ((formData.get("notes") as string | null) ?? "").trim() || null,
    performed_at: ((formData.get("performed_at") as string | null) ?? "").trim() || null,
    findings: importedFindings,
  };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/vendor-assessments`, {
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
    return { error: data.error ?? "Failed to create assessment" };
  }

  revalidatePath(`/vendors/${vendorId}`);
  redirect(`/vendors/${vendorId}`);
}
