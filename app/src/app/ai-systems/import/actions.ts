"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type AiSystemImportRow = {
  name: string;
  use_case?: string;
  model_type?: string;
  data_classification?: string;
  deployment_status?: string;
  criticality?: string;
  risk_classification?: string;
};

export type AiSystemImportResult = {
  total: number;
  created: number;
  skipped: number;
  errors: number;
  results: Array<{
    name: string;
    status: "created" | "skipped" | "error";
    message?: string;
    id?: string;
  }>;
};

export async function importAiSystems(rows: AiSystemImportRow[]): Promise<AiSystemImportResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({ name: r.name, status: "error" as const, message: "Not authenticated" })),
    };
  }

  if (rows.length > 500) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({ name: r.name, status: "error" as const, message: "Import limit exceeded (max 500 rows)" })),
    };
  }

  const results: AiSystemImportResult["results"] = [];

  for (const row of rows) {
    const body: Record<string, string> = { name: row.name };
    if (row.use_case)            body.use_case            = row.use_case;
    if (row.model_type)          body.model_type          = row.model_type;
    if (row.data_classification) body.data_classification = row.data_classification;
    if (row.deployment_status)   body.deployment_status   = row.deployment_status;
    if (row.criticality)         body.criticality         = row.criticality;
    if (row.risk_classification) body.risk_classification = row.risk_classification;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/ai-systems`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      results.push({ name: row.name, status: "error", message: "Network error" });
      continue;
    }

    if (res.status === 201) {
      const data = (await res.json().catch(() => ({}))) as { ai_system?: { id?: string } };
      results.push({ name: row.name, status: "created", id: data.ai_system?.id });
      continue;
    }
    if (res.status === 409) {
      results.push({ name: row.name, status: "skipped", message: "Already exists" });
      continue;
    }
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      results.push({ name: row.name, status: "error", message: data.detail ?? data.error ?? "Invalid data" });
      continue;
    }
    results.push({ name: row.name, status: "error", message: "Failed to create AI system" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
