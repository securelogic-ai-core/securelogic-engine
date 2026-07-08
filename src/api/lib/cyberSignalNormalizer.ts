/**
 * cyberSignalNormalizer.ts — Pure normalization helpers for cyber signal ingestion.
 *
 * No I/O. All functions are pure and fully unit-testable.
 *
 * DEDUPLICATION HASH
 * ------------------
 * Two key shapes, selected by whether a stable per-item external_id is present:
 *
 *   external_id ABSENT (legacy):  source|signal_type|affected_cve|affected_vendor
 *   external_id PRESENT:          source|signal_type|id:<external_id>
 *
 * Each component is lowercased and trimmed before hashing; absent components
 * are empty strings. This ensures:
 *   - Same CVE from different sources → different hashes (intended: CISA and NVD
 *     may carry different metadata for the same CVE and should both be stored).
 *   - Same CVE, same source, same org → duplicate (blocked by unique constraint).
 *   - Different orgs ingesting the same signal each get their own row; uniqueness
 *     is enforced by the DB UNIQUE(organization_id, dedup_hash) constraint.
 *
 * The external_id branch exists because vendorless / CVE-less sources (every
 * regulatory feed; news items with no CVE/vendor in the title) otherwise hash
 * to an identical source|signal_type|| key and collapse to a single stored row
 * per (source, signal_type). Sources that DO set affected_cve (CISA KEV, NVD)
 * leave external_id null and therefore take the legacy branch BYTE-FOR-BYTE
 * unchanged — no hash drift, no re-ingestion.
 *
 * NORMALIZED SUMMARY AUTO-DERIVATION
 * -----------------------------------
 * If the caller does not supply a normalized_summary, one is derived from the
 * raw_payload using best-effort field extraction. Known field names from CISA
 * KEV, NVD CVE feed, generic RSS, and vendor advisory formats are checked in
 * priority order. If no usable text is found, a minimal fallback is built from
 * signal_type, affected_cve, and affected_vendor.
 */

import { createHash } from "crypto";
import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";
import { clusterKey } from "./signals/clusterKey.js";
import { stripHtmlToText } from "./sanitize.js";
import { signalSanitizeEnabled } from "./signalSanitizeFeatureFlag.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NormalizedCyberSignal = {
  source: string;
  signal_type: string;
  severity: string;
  raw_payload: Record<string, unknown>;
  normalized_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
  external_id: string | null;
  dedup_hash: string;
  /**
   * IQP Q2: SOURCE-AUTHORITATIVE event date (ISO string), derived from the
   * raw_payload's known date keys (KEV dateAdded, NVD published, RSS pubDate,
   * Federal Register publication_date, EDGAR file_date). null = unknown →
   * consumers fall back to ingestion_timestamp. The write is unconditional
   * (an unread nullable column is behavior-neutral); READING it is gated on
   * SECURELOGIC_SIGNAL_RECENCY_ENABLED.
   */
  published_at: string | null;
  /**
   * C2 (P4/4C): soft corroboration grouping from clusterKey() — BESIDE
   * dedup_hash, never part of it. null ⇒ singleton. Computed here as the single
   * source of truth; persistence to cyber_signals.cluster_key is handled by the
   * backfill script (the 13 INSERT sites are intentionally not modified in C2),
   * so the column is NULL on fresh rows until a backfill pass stamps it.
   */
  cluster_key: string | null;
};

// ---------------------------------------------------------------------------
// buildDedupHash
// ---------------------------------------------------------------------------

/**
 * Build a deterministic SHA-256 deduplication hash for a signal.
 *
 * All inputs are normalized to lowercase and trimmed before hashing.
 *
 * When `externalId` is present and non-empty, the key is
 *   source|signal_type|id:<external_id>
 * so the per-item id is the sole discriminator. When it is null/empty, the key
 * is the LEGACY composite source|signal_type|cve|vendor — reproduced here
 * byte-for-byte so callers that do not pass an external_id (CISA KEV, NVD, and
 * every existing row) keep their exact current hash. Do not alter the legacy
 * branch: its stability is the zero-regression guarantee.
 *
 * @example
 *   buildDedupHash("cisa", "cve", "CVE-2024-12345", null)
 *   // sha256("cisa|cve|cve-2024-12345|")
 *   buildDedupHash("nist_news", "regulatory_change", null, null, "guid-abc")
 *   // sha256("nist_news|regulatory_change|id:guid-abc")
 */
export function buildDedupHash(
  source: string,
  signalType: string,
  affectedCve: string | null,
  affectedVendor: string | null,
  externalId: string | null = null
): string {
  const trimmedId = externalId?.trim() ?? "";

  const key =
    trimmedId !== ""
      ? `${source.toLowerCase().trim()}|${signalType.toLowerCase().trim()}|id:${trimmedId.toLowerCase()}`
      : [
          source.toLowerCase().trim(),
          signalType.toLowerCase().trim(),
          (affectedCve ?? "").toLowerCase().trim(),
          (affectedVendor ?? "").toLowerCase().trim()
        ].join("|");

  return createHash("sha256").update(key, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// deriveSummaryFromPayload
// ---------------------------------------------------------------------------

/**
 * Derive a normalized summary from the raw payload when the caller did not
 * provide one. Checks field names common across CISA KEV, NVD, RSS, and
 * generic advisory formats in priority order.
 *
 * Falls back to a constructed string from signal_type, CVE ID, and vendor name
 * if no usable text field is found in the payload.
 */
export function deriveSummaryFromPayload(
  payload: Record<string, unknown>,
  signalType: string,
  affectedCve: string | null,
  affectedVendor: string | null
): string {
  // Field names in priority order, covering known feed formats.
  const candidates = [
    "title",              // most RSS feeds, CISA advisories
    "summary",            // Atom feeds, generic
    "description",        // NVD CVE descriptions, generic
    "vulnerabilityName",  // CISA KEV
    "shortDescription",   // NVD nested
    "name",               // vendor advisory formats
    "message",            // generic webhook formats
    "shortName",          // compact advisory formats
    "headline"            // some threat intelligence feeds
  ];

  for (const field of candidates) {
    const val = payload[field];
    if (typeof val === "string" && val.trim().length > 0) {
      // Truncate extremely long descriptions to 500 chars for storage efficiency.
      const trimmed = val.trim();
      return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
    }
  }

  // Fallback: construct a minimal but meaningful summary.
  const parts: string[] = [signalType.toUpperCase()];
  if (affectedCve !== null) parts.push(affectedCve);
  if (affectedVendor !== null) parts.push(`— affecting ${affectedVendor}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// derivePublishedAt
// ---------------------------------------------------------------------------

/** raw_payload date keys, in priority order, per source family. */
const PUBLISHED_AT_KEYS = [
  "dateAdded",         // CISA KEV
  "published",         // NVD
  "pubDate",           // RSS/Atom
  "publication_date",  // Federal Register
  "file_date",         // SEC EDGAR
  "date"               // generic
] as const;

/**
 * IQP Q2: derive the source-authoritative event date from the raw payload.
 *
 * Returns an ISO-8601 string, or null when no key parses to a plausible date.
 * Bounds guard mirrors the 20260828 backfill migration: dates before 1990 or
 * more than 1 day in the future are treated as unknown (null). Pure —
 * `now` is injectable for deterministic tests.
 */
export function derivePublishedAt(
  payload: Record<string, unknown>,
  now: Date = new Date()
): string | null {
  for (const key of PUBLISHED_AT_KEYS) {
    const val = payload[key];
    if (typeof val !== "string" || val.trim() === "") continue;
    const parsed = new Date(val.trim());
    if (Number.isNaN(parsed.getTime())) continue;
    if (parsed.getTime() < Date.UTC(1990, 0, 1)) continue;
    if (parsed.getTime() > now.getTime() + 24 * 60 * 60 * 1000) continue;
    return parsed.toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// normalizeSignal
// ---------------------------------------------------------------------------

/**
 * Normalize a validated ingest input into a fully resolved signal record
 * ready for DB insertion.
 *
 * - Derives normalized_summary from raw_payload if not supplied.
 * - Computes the dedup_hash.
 * - All other fields pass through from the validated input.
 */
export function normalizeSignal(
  input: CyberSignalIngestInput,
  // Ingestion moment for clusterKey()'s CVE-less day-bucket. Injectable for
  // determinism in tests; defaults to now (≈ the INSERT's ingestion_timestamp).
  at: Date = new Date(),
  // IQP Q1: HTML sanitization of the stored summary. Defaults to the feature
  // flag so all existing call sites pick it up unchanged; injectable so tests
  // are deterministic. OFF ⇒ byte-identical to pre-Q1.
  sanitizeEnabled: boolean = signalSanitizeEnabled()
): NormalizedCyberSignal {
  let normalizedSummary =
    input.normalized_summary !== null
      ? input.normalized_summary
      : deriveSummaryFromPayload(
          input.raw_payload,
          input.signal_type,
          input.affected_cve,
          input.affected_vendor
        );

  // IQP Q1 (audit defect #3): the ONE ingest-side sanitization point. Both
  // summary routes (caller-supplied and payload-derived) pass through here.
  // raw_payload itself stays raw — it is the provenance record.
  if (sanitizeEnabled) {
    normalizedSummary = stripHtmlToText(normalizedSummary);
  }

  const externalId =
    typeof input.external_id === "string" && input.external_id.trim() !== ""
      ? input.external_id.trim()
      : null;

  const dedupHash = buildDedupHash(
    input.source,
    input.signal_type,
    input.affected_cve,
    input.affected_vendor,
    externalId
  );

  // C2: soft cluster grouping (single source of truth = clusterKey()). Computed
  // beside dedup_hash; never part of it. Not persisted by the INSERT sites in
  // C2 — the backfill script stamps cyber_signals.cluster_key.
  const clusterKeyValue = clusterKey({
    affected_cve: input.affected_cve,
    affected_vendor: input.affected_vendor,
    signal_type: input.signal_type,
    ingestion_timestamp: at
  });

  return {
    source: input.source,
    signal_type: input.signal_type,
    severity: input.severity,
    raw_payload: input.raw_payload,
    normalized_summary: normalizedSummary,
    affected_vendor: input.affected_vendor,
    affected_cve: input.affected_cve,
    external_id: externalId,
    dedup_hash: dedupHash,
    cluster_key: clusterKeyValue,
    // IQP Q2: source-authoritative event date (write unconditional; read
    // gated on SECURELOGIC_SIGNAL_RECENCY_ENABLED).
    published_at: derivePublishedAt(input.raw_payload, at)
  };
}
