"use server";

import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type FindingImportRow = {
  title: string;
  /**
   * The canonical severity, when the row's value maps to one. Left undefined
   * when it does not — the engine then derives it from source_severity, or
   * records that the finding has none. The importer never guesses.
   */
  severity?: string;
  source_type: string;
  /** What the report actually said, verbatim. Always sent when present. */
  source_severity?: string;
  source_reference_id?: string;
  cvss_score?: string;
  cvss_vector?: string;
  /** SL-VULN-1. Names WHAT the weakness is, not which occurrence it is. */
  cve_id?: string;
  cwe_id?: string;
  /** Which CVSS revision produced cvss_score — a bare score is ambiguous. */
  cvss_version?: string;
  /**
   * What the SOURCE said about its own observation window. Passed through
   * as stated; the platform never maintains these. Re-importing the same
   * vulnerability creates a NEW finding — it does not advance last_seen_at
   * on an existing one, because no per-occurrence identity exists.
   */
  first_seen_at?: string;
  last_seen_at?: string;
  /** The pen-test engagement this row came from (pen_test rows only). */
  source_id?: string;
  description?: string;
  domain?: string;
  priority?: string;
  likelihood?: string;
  due_date?: string;
  recommendation?: string;
};

export type FindingImportResult = {
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

export async function importFindings(rows: FindingImportRow[]): Promise<FindingImportResult> {
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

  const results: FindingImportResult["results"] = [];

  for (const row of rows) {
    const body: Record<string, string> = {
      title: row.title,
      source_type: row.source_type,
    };
    // Omitted deliberately when the row's severity did not map: the engine
    // normalises source_severity itself, so the mapping table lives in one
    // place and an Informational finding is never assigned a level here.
    if (row.severity)            body.severity            = row.severity;
    if (row.source_severity)     body.source_severity     = row.source_severity;
    if (row.source_reference_id) body.source_reference_id = row.source_reference_id;
    if (row.cvss_score)          body.cvss_score          = row.cvss_score;
    if (row.cvss_vector)         body.cvss_vector         = row.cvss_vector;
    if (row.cve_id)              body.cve_id              = row.cve_id;
    if (row.cwe_id)              body.cwe_id              = row.cwe_id;
    if (row.cvss_version)        body.cvss_version        = row.cvss_version;
    if (row.first_seen_at)       body.first_seen_at       = row.first_seen_at;
    if (row.last_seen_at)        body.last_seen_at        = row.last_seen_at;
    if (row.source_id)           body.source_id           = row.source_id;
    if (row.description)    body.description    = row.description;
    if (row.domain)         body.domain         = row.domain;
    if (row.priority)       body.priority       = row.priority;
    if (row.likelihood)     body.likelihood     = row.likelihood;
    if (row.due_date)       body.due_date       = row.due_date;
    if (row.recommendation) body.recommendation = row.recommendation;

    let res: Response;
    try {
      res = await fetch(`${ENGINE_URL}/api/findings`, {
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
      const data = (await res.json().catch(() => ({}))) as { finding?: { id?: string } };
      results.push({ name: row.title, status: "created", id: data.finding?.id });
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
    results.push({ name: row.title, status: "error", message: "Failed to create finding" });
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors:  results.filter((r) => r.status === "error").length,
    results,
  };
}
