"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export async function createFindingsForFailures(
  frameworkId: string,
  frameworkName: string,
  failures: Array<{ requirementId: string; referenceId: string; title: string }>
): Promise<{ created: number } | { error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  let created = 0;
  for (const f of failures) {
    try {
      const res = await fetch(`${ENGINE_URL}/api/findings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `${f.referenceId}: ${f.title}`,
          severity: "Moderate",
          domain: "Compliance",
          description: `Requirement failed during self-assessment of ${frameworkName}.`,
          recommendation: null,
          source_type: "compliance_assessment",
          source_id: frameworkId,
          status: "open",
        }),
      });
      if (res.ok) created++;
    } catch {
      // continue best-effort
    }
  }

  return { created };
}
