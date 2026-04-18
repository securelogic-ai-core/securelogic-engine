"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type ObligationImportRow = {
  title: string;
  description?: string;
  source_regulation?: string;
  jurisdiction?: string;
  domain?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  notes?: string;
};

export type ObligationImportResult = {
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

export async function importObligations(rows: ObligationImportRow[]): Promise<ObligationImportResult> {
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

  const results: ObligationImportResult["results"] = [];

  for (const row of rows) {
    const body: Record<string, string> = { title: row.title };
    if (row.description)       body.description       = row.description;
    if (row.source_regulation) body.source_regulation = row.source_regulation;
    if (row.jurisdiction)      body.jurisdiction      = row.jurisdiction;
    if (row.domain)            body.domain            = row.domain;
    if (row.status)            body.status            = row.status;
    if (row.priority)          body.priority          = row.priority;
    if (row.due_date)          body.due_date          = row.due_date;
    if (row.notes)             body.notes             = row.notes;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/obligations`, {
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
      const data = (await res.json().catch(() => ({}))) as { obligation?: { id?: string } };
      results.push({ name: row.title, status: "created", id: data.obligation?.id });
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
    results.push({ name: row.title, status: "error", message: "Failed to create obligation" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
