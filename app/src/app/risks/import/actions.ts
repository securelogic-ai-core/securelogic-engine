"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Bulk import row shape — package risk-register-inherent-residual-rating
 * Phase 4. Strict mode: all 6 rating fields (3 inherent + 3 residual) are
 * required. The legacy 3-field form is rejected at the upload step.
 *
 * Mirrors the create form's contract (app/src/app/risks/new/actions.ts):
 * legacy likelihood/impact/risk_rating are populated from residual_* on
 * the wire (Path (i)), satisfying the Phase 2 POST validator's 9-field
 * requirement without backend changes.
 */
export type RiskImportRow = {
  title: string;
  domain: string;
  inherent_likelihood: string;
  inherent_impact: string;
  inherent_rating: string;
  residual_likelihood: string;
  residual_impact: string;
  residual_rating: string;
  description?: string;
  status?: string;
  treatment?: string;
  owner?: string;
  due_date?: string;
};

export type RiskImportResult = {
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

export async function importRisks(rows: RiskImportRow[]): Promise<RiskImportResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({ name: r.title, status: "error" as const, message: "Not authenticated" })),
    };
  }

  if (rows.length > 500) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      results: rows.map((r) => ({ name: r.title, status: "error" as const, message: "Import limit exceeded (max 500 rows)" })),
    };
  }

  const results: RiskImportResult["results"] = [];

  for (const row of rows) {
    // Mirror residual into legacy at the wire (Path (i) — same pattern
    // as createRiskAction). The Phase 2 POST validator requires all 9
    // rating fields; CSV exposes only the 6 user-facing ones, so legacy
    // is auto-populated from residual_*.
    const body: Record<string, string> = {
      title:               row.title,
      domain:              row.domain,
      likelihood:          row.residual_likelihood,
      impact:              row.residual_impact,
      risk_rating:         row.residual_rating,
      inherent_likelihood: row.inherent_likelihood,
      inherent_impact:     row.inherent_impact,
      inherent_rating:     row.inherent_rating,
      residual_likelihood: row.residual_likelihood,
      residual_impact:     row.residual_impact,
      residual_rating:     row.residual_rating,
    };
    if (row.description) body.description = row.description;
    if (row.status)      body.status      = row.status;
    if (row.treatment)   body.treatment   = row.treatment;
    if (row.owner)       body.owner       = row.owner;
    if (row.due_date)    body.due_date    = row.due_date;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      results.push({ name: row.title, status: "error", message: "Network error" });
      continue;
    }

    if (res.status === 201) {
      const data = (await res.json().catch(() => ({}))) as { risk?: { id?: string } };
      results.push({ name: row.title, status: "created", id: data.risk?.id });
      continue;
    }
    if (res.status === 409) {
      results.push({ name: row.title, status: "skipped", message: "Already exists" });
      continue;
    }
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      results.push({ name: row.title, status: "error", message: data.detail ?? data.error ?? "Invalid data" });
      continue;
    }
    results.push({ name: row.title, status: "error", message: "Failed to create risk" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
