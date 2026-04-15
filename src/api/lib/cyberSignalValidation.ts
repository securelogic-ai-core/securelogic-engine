/**
 * cyberSignalValidation.ts — Pure validation for cyber signal ingest input.
 *
 * No I/O. All functions are pure and fully unit-testable.
 *
 * SOURCE vs SIGNAL_TYPE enforcement:
 *   VALID_SOURCES is validated in the application layer but NOT enforced by a
 *   DB CHECK constraint. The source list is intentionally extensible — adding a
 *   new adapter (CISA, NVD, custom RSS feed) should not require a DB migration.
 *   The canonical set here documents the expected values; unknown sources are
 *   rejected with a clear error.
 *
 *   VALID_SIGNAL_TYPES is enforced by both this module and the DB CHECK
 *   constraint. Signal type forms the canonical taxonomy for domain routing
 *   and posture scoring attribution. New types require both a migration and
 *   an update to this module.
 *
 * CVE ID format:
 *   affected_cve, if provided, must match CVE-YYYY-NNNNN (4+ digit ID suffix).
 *   It is normalised to uppercase before being stored.
 */

import { sanitizeString } from "./sanitize.js";

const MAX_SUMMARY = 2000;
const MAX_VENDOR = 255;

export const VALID_SOURCES = new Set([
  "cisa",
  "cisa_kev",
  "cisa_alerts",
  "nvd",
  "bleepingcomputer",
  "krebsonsecurity",
  "sans_isc",
  "nist_news",
  "ftc_news",
  "mitre_attack",
  "mitre_atlas",
  "rss",
  "mock",
  "manual"
]);

export const VALID_SIGNAL_TYPES = new Set([
  "cve",
  "threat_actor",
  "advisory",
  "breach",
  "patch",
  "malware",
  "geopolitical",
  // Extended taxonomy for broad threat intelligence coverage
  "regulatory_change",   // new/updated regulation, framework, or compliance requirement
  "third_party_breach",  // confirmed breach at a vendor, supplier, or third party
  "data_exposure",       // data leak, exposed credentials, or dark web mention
  "patch_advisory",      // vendor security advisory not tied to a specific CVE
  "vulnerability"        // TTP-level technique or attack vector (MITRE ATT&CK, ATLAS)
]);

export const VALID_SEVERITIES = new Set([
  "Critical",
  "High",
  "Moderate",
  "Low"
]);

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CyberSignalIngestInput = {
  source: string;
  signal_type: string;
  severity: string;
  raw_payload: Record<string, unknown>;
  /** null means: derive from raw_payload during normalization */
  normalized_summary: string | null;
  affected_vendor: string | null;
  /** Normalised to uppercase CVE-YYYY-NNNNN */
  affected_cve: string | null;
};

export type CyberSignalIngestResult =
  | { input: CyberSignalIngestInput }
  | { error: string; detail?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// validateCyberSignalIngest
// ---------------------------------------------------------------------------

export function validateCyberSignalIngest(body: unknown): CyberSignalIngestResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // source — required, must be in the known set
  const source = isNonEmptyString(b.source) ? b.source.trim() : null;
  if (source === null) {
    return { error: "source_required" };
  }
  if (!VALID_SOURCES.has(source)) {
    return {
      error: "invalid_source",
      detail: `source must be one of: ${[...VALID_SOURCES].join(", ")}`
    };
  }

  // signal_type — required, must be in the canonical taxonomy
  const signalType = isNonEmptyString(b.signal_type) ? b.signal_type.trim() : null;
  if (signalType === null) {
    return { error: "signal_type_required" };
  }
  if (!VALID_SIGNAL_TYPES.has(signalType)) {
    return {
      error: "invalid_signal_type",
      detail: `signal_type must be one of: ${[...VALID_SIGNAL_TYPES].join(", ")}`
    };
  }

  // severity — required, must be in the canonical set
  const severity = isNonEmptyString(b.severity) ? b.severity.trim() : null;
  if (severity === null) {
    return { error: "severity_required" };
  }
  if (!VALID_SEVERITIES.has(severity)) {
    return {
      error: "invalid_severity",
      detail: "severity must be one of: Critical, High, Moderate, Low"
    };
  }

  // raw_payload — required, must be a plain object
  if (b.raw_payload === undefined || b.raw_payload === null) {
    return { error: "raw_payload_required" };
  }
  if (!isPlainObject(b.raw_payload)) {
    return { error: "raw_payload_must_be_object" };
  }

  // normalized_summary — optional; if absent the normalizer derives it
  const normalizedSummary =
    isNonEmptyString(b.normalized_summary)
      ? sanitizeString(b.normalized_summary.trim(), MAX_SUMMARY)
      : null;

  // affected_vendor — optional; if present must be a non-empty string
  let affectedVendor: string | null = null;
  if ("affected_vendor" in b && b.affected_vendor !== null && b.affected_vendor !== undefined) {
    if (!isNonEmptyString(b.affected_vendor)) {
      return { error: "affected_vendor_must_be_non_empty_string" };
    }
    affectedVendor = sanitizeString((b.affected_vendor as string).trim(), MAX_VENDOR);
  }

  // affected_cve — optional; if present must match CVE-YYYY-NNNNN
  let affectedCve: string | null = null;
  if ("affected_cve" in b && b.affected_cve !== null && b.affected_cve !== undefined) {
    if (!isNonEmptyString(b.affected_cve)) {
      return { error: "affected_cve_must_be_non_empty_string" };
    }
    const cveRaw = (b.affected_cve as string).trim().toUpperCase();
    if (!CVE_RE.test(cveRaw)) {
      return {
        error: "affected_cve_invalid_format",
        detail: "Expected format: CVE-YYYY-NNNNN (e.g. CVE-2024-12345)"
      };
    }
    affectedCve = cveRaw;
  }

  return {
    input: {
      source,
      signal_type: signalType,
      severity,
      raw_payload: b.raw_payload as Record<string, unknown>,
      normalized_summary: normalizedSummary,
      affected_vendor: affectedVendor,
      affected_cve: affectedCve
    }
  };
}
