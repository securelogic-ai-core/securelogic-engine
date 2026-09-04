"use server";

import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

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
  /**
   * SL-OCC-1b — where this vulnerability was found.
   *
   * Any combination may be supplied; the engine resolves them against the
   * assets this org already has. NOTHING HERE CREATES AN ASSET: an identifier
   * that resolves to nothing leaves the vulnerability recorded WITHOUT an
   * occurrence, which is a valid record. Inventing a placeholder host to satisfy
   * the occurrence model would put fiction in the inventory.
   *
   * asset_ip is accepted because scan exports contain it, but an IP is a lease
   * rather than a name and never resolves on its own — see assetIdentity.ts.
   */
  asset_hostname?: string;
  asset_fqdn?: string;
  asset_ip?: string;
  asset_cloud_resource_id?: string;
  asset_internal_id?: string;
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
  /** Rows whose asset identifiers resolved to an asset and produced an occurrence. */
  occurrencesLinked: number;
  /**
   * Rows that named an asset we could not resolve, or that resolved ambiguously.
   * The vulnerability WAS imported — this is reported, not failed, because a
   * vulnerability with no asset is a legitimate record and refusing the row
   * would lose real data over a lookup miss.
   */
  occurrencesUnresolved: number;
  results: Array<{
    name: string;
    status: "created" | "skipped" | "error";
    message?: string;
    id?: string;
    /** Present only when the row supplied asset identifiers. */
    assetOutcome?: "linked" | "not_found" | "ambiguous";
    assetNote?: string;
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
      occurrencesLinked: 0,
      occurrencesUnresolved: 0,
      results: rows.map((r) => ({ name: r.title, status: "error" as const, message: "Not authenticated" })),
    };
  }

  if (rows.length > 500) {
    return {
      total: rows.length,
      created: 0,
      skipped: 0,
      errors: rows.length,
      occurrencesLinked: 0,
      occurrencesUnresolved: 0,
      results: rows.map((r) => ({ name: r.title, status: "error" as const, message: "Import limit exceeded (max 500 rows)" })),
    };
  }

  const results: FindingImportResult["results"] = [];

  /**
   * Attach the imported finding to the asset the row names, if any.
   *
   * Deliberately BEST-EFFORT and never fatal. The vulnerability is already
   * recorded by this point; a lookup miss, an ambiguous hostname or a transport
   * error must not undo that, because a vulnerability with no asset is a valid
   * record and losing it over a failed join would be the worse outcome. Every
   * outcome is reported per row so the importer can say what happened rather
   * than silently dropping the association.
   */
  async function linkAsset(
    findingId: string,
    row: FindingImportRow,
  ): Promise<{ outcome: "linked" | "not_found" | "ambiguous"; note?: string } | null> {
    const identifiers = [
      { scheme: "hostname", value: row.asset_hostname },
      { scheme: "fqdn", value: row.asset_fqdn },
      { scheme: "ip", value: row.asset_ip },
      { scheme: "cloud_resource_id", value: row.asset_cloud_resource_id },
      { scheme: "internal_id", value: row.asset_internal_id },
    ].filter((i): i is { scheme: string; value: string } =>
      typeof i.value === "string" && i.value.trim().length > 0);

    if (identifiers.length === 0) return null;

    try {
      const resolveRes = await fetch(`${ENGINE_URL}/api/assets/resolve-identifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ identifiers }),
        cache: "no-store",
      });
      if (!resolveRes.ok) return { outcome: "not_found", note: "Asset lookup unavailable" };

      const resolution = (await resolveRes.json()) as
        { outcome: string; assetId?: string; reason?: string };

      if (resolution.outcome === "ambiguous") {
        return { outcome: "ambiguous", note: resolution.reason };
      }
      if (resolution.outcome !== "resolved" || !resolution.assetId) {
        return { outcome: "not_found", note: resolution.reason };
      }

      const occRes = await fetch(
        `${ENGINE_URL}/api/findings/${findingId}/occurrences`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ asset_id: resolution.assetId, source: "import" }),
          cache: "no-store",
        },
      );
      return occRes.ok
        ? { outcome: "linked" }
        : { outcome: "not_found", note: "Could not record the occurrence" };
    } catch {
      return { outcome: "not_found", note: "Asset lookup failed" };
    }
  }

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
      const findingId = data.finding?.id;
      const asset = findingId ? await linkAsset(findingId, row) : null;
      results.push({
        name: row.title,
        status: "created",
        id: findingId,
        ...(asset ? { assetOutcome: asset.outcome, assetNote: asset.note } : {}),
      });
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
    occurrencesLinked: results.filter((r) => r.assetOutcome === "linked").length,
    occurrencesUnresolved: results.filter(
      (r) => r.assetOutcome === "not_found" || r.assetOutcome === "ambiguous").length,
    results,
  };
}
