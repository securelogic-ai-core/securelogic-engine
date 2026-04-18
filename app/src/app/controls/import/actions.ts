"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type ControlImportRow = {
  name: string;
  description?: string;
  testing_frequency?: string;
  next_test_due?: string;
};

export type ControlImportResult = {
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

export async function importControls(rows: ControlImportRow[]): Promise<ControlImportResult> {
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

  const results: ControlImportResult["results"] = [];

  for (const row of rows) {
    const body: Record<string, string> = { name: row.name };
    if (row.description)       body.description       = row.description;
    if (row.testing_frequency) body.testing_frequency = row.testing_frequency;
    if (row.next_test_due)     body.next_test_due     = row.next_test_due;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/controls`, {
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
      const data = (await res.json().catch(() => ({}))) as { control?: { id?: string } };
      results.push({ name: row.name, status: "created", id: data.control?.id });
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
    results.push({ name: row.name, status: "error", message: "Failed to create control" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
