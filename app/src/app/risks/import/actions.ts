"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type RiskImportRow = {
  title: string;
  domain: string;
  likelihood: string;
  impact: string;
  risk_rating: string;
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
    const body: Record<string, string> = {
      title:       row.title,
      domain:      row.domain,
      likelihood:  row.likelihood,
      impact:      row.impact,
      risk_rating: row.risk_rating,
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
