/**
 * mitreAtlasAdapter.ts — MITRE ATLAS AI-specific attack technique adapter.
 *
 * Fetches the MITRE ATLAS dataset (STIX 2.1 bundle) from the official
 * atlas-data GitHub repository and maps AI-specific attack techniques to
 * the platform's CyberSignalIngestInput format.
 *
 * MITRE ATLAS (Adversarial Threat Landscape for Artificial-Intelligence Systems)
 * documents tactics, techniques, and case studies for adversarial attacks on
 * AI/ML systems. It mirrors the ATT&CK structure but is scoped to AI threats.
 *
 * DATA SOURCE
 * -----------
 * MITRE ATLAS STIX 2.1 bundle from the atlas-data GitHub repository:
 *   https://raw.githubusercontent.com/mitre-atlas/atlas-data/main/dist/stix-atlas.json
 *
 * OBJECT TYPES EXTRACTED
 * ----------------------
 *   attack-pattern → AI/ML attack technique (signal_type: 'threat_actor')
 *
 * Course-of-action and other non-technique objects are skipped.
 * Deprecated and revoked objects are skipped.
 *
 * AI GOVERNANCE DOMAIN TAGGING
 * -----------------------------
 * All ATLAS signals use source 'mitre_atlas'. When processed by the signal
 * pipeline, signals matching a known AI system in the platform will be routed
 * to the 'AI Governance' domain via resolveSignalDomain(). Signals without a
 * matching AI system are stored as 'Vulnerability' domain signals and remain
 * available for manual review and AI system linkage.
 *
 * SEVERITY
 * --------
 * ATLAS does not include CVSS or prevalence scores. All extracted techniques
 * are assigned 'High' severity — ATLAS techniques represent validated adversarial
 * attack patterns specifically targeting deployed AI/ML systems and warrant
 * consistent High-floor treatment analogous to CISA advisory handling.
 *
 * DEDUPLICATION KEY
 * -----------------
 * The ATT&CK-style ATLAS external ID (AML.T0001, AML.T0002 etc.) is stored in
 * affected_vendor to provide a unique per-technique dedup discriminator within
 * the platform's SHA-256 hash scheme (source|signal_type|affected_cve|affected_vendor).
 * ATLAS IDs are prefixed 'AML.' and never match real vendor names.
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * extractAtlasId()         — pure, no I/O.
 * buildAtlasSummary()      — pure, no I/O.
 * mapAtlasObjectToSignal() — pure, no I/O; fully unit-testable.
 * fetchMitreAtlasSignals() — performs the HTTP fetch, calls mapAtlasObjectToSignal.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";
import { getEtag, setEtag } from "./feedEtagStore.js";
import type { StixBundle, StixExternalReference, StixObject } from "./mitreAttackAdapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Updated 2026-05-02: MITRE moved the ATLAS STIX bundle from the
// `mitre-atlas/atlas-data` repo to `mitre-atlas/atlas-navigator-data`. The
// old URL now returns 404. The smoke test in __tests__/mitreBundleUrls.live.test.ts
// (gated on MITRE_SMOKE_TEST=1) is the trip-wire for the next reorganization.
export const MITRE_ATLAS_BUNDLE_URL =
  "https://raw.githubusercontent.com/mitre-atlas/atlas-navigator-data/main/dist/stix-atlas.json";

/** Redis key holding the most recently observed ETag for the ATLAS bundle. */
export const MITRE_ATLAS_ETAG_KEY = "mitre:atlas:etag";

/** Source names used in ATLAS STIX external_references. */
const ATLAS_SOURCE_NAMES = new Set(["ATLAS", "mitre-atlas"]);

/** Object types to extract from the ATLAS bundle. */
const ATLAS_OBJECT_TYPES = new Set(["attack-pattern"]);

// Re-export StixObject so tests can import from one location.
export type { StixObject, StixBundle, StixExternalReference };

// ---------------------------------------------------------------------------
// extractAtlasId
// ---------------------------------------------------------------------------

/**
 * Extract the ATLAS external ID (AML.T0001, AML.T0001.000, etc.) from a STIX
 * object's external_references array.
 *
 * ATLAS uses source_name "ATLAS" (older datasets) or "mitre-atlas" (newer).
 * Returns null if no matching reference with an external_id is found.
 */
export function extractAtlasId(obj: StixObject): string | null {
  if (!Array.isArray(obj.external_references)) return null;

  for (const ref of obj.external_references) {
    if (ATLAS_SOURCE_NAMES.has(ref.source_name) && ref.external_id) {
      return ref.external_id.trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildAtlasSummary
// ---------------------------------------------------------------------------

/**
 * Build a normalized summary for an ATLAS STIX object.
 *
 * Format: "AI Technique <ID>: <name> — <truncated description>"
 * Total capped at 500 characters to match platform normalizer limits.
 */
export function buildAtlasSummary(obj: StixObject, atlasId: string): string {
  const nameRaw = obj.name?.trim() ?? "";
  const descRaw = obj.description?.trim() ?? "";

  const namePart = nameRaw
    ? `AI Technique ${atlasId}: ${nameRaw}`
    : `AI Technique ${atlasId}`;

  if (!descRaw) {
    return namePart.length > 500 ? `${namePart.slice(0, 497)}...` : namePart;
  }

  const truncatedDesc = descRaw.length > 300 ? `${descRaw.slice(0, 297)}...` : descRaw;
  const full = `${namePart} — ${truncatedDesc}`;

  return full.length > 500 ? `${full.slice(0, 497)}...` : full;
}

// ---------------------------------------------------------------------------
// mapAtlasObjectToSignal  (pure)
// ---------------------------------------------------------------------------

/**
 * Map a single ATLAS STIX object to a CyberSignalIngestInput.
 *
 * Returns null when the object should be skipped:
 *   - Object type is not 'attack-pattern'
 *   - Deprecated (x_mitre_deprecated: true)
 *   - Revoked (x_mitre_revoked: true)
 *   - No extractable ATLAS external ID (e.g., relationship objects)
 *   - No name
 *
 * Signal type is 'threat_actor' — ATLAS techniques describe adversarial attack
 * patterns against AI systems and are classified as threat intelligence,
 * consistent with how ATT&CK intrusion-set signals are typed.
 *
 * Severity is uniformly 'High'. ATLAS techniques represent validated adversarial
 * AI attack patterns; there is no CVSS-equivalent scoring in the dataset.
 *
 * The ATLAS external ID is stored in affected_vendor for dedup isolation.
 */
export function mapAtlasObjectToSignal(
  obj: StixObject
): CyberSignalIngestInput | null {
  // Skip non-technique objects (relationship, course-of-action, etc.)
  if (!ATLAS_OBJECT_TYPES.has(obj.type)) return null;

  // Skip deprecated and revoked entries
  if (obj.x_mitre_deprecated === true) return null;
  if (obj.x_mitre_revoked === true) return null;

  // Must have an ATLAS external ID for dedup and traceability
  const atlasId = extractAtlasId(obj);
  if (atlasId === null) return null;

  // Must have a name
  if (!obj.name?.trim()) return null;

  const normalizedSummary = buildAtlasSummary(obj, atlasId);

  const rawPayload: Record<string, unknown> = {
    stix_id: obj.id,
    stix_type: obj.type,
    atlas_id: atlasId,
    name: obj.name?.trim() ?? null,
    description: obj.description ?? null,
    is_subtechnique: obj.x_mitre_is_subtechnique ?? false,
    kill_chain_phases: obj.kill_chain_phases ?? [],
    external_references: obj.external_references ?? []
  };

  return {
    source: "mitre_atlas",
    signal_type: "threat_actor",
    severity: "High",
    raw_payload: rawPayload,
    normalized_summary: normalizedSummary,
    // ATLAS ID in affected_vendor serves as the per-technique dedup discriminator.
    // AML.T-prefixed IDs never match real vendor names in the vendor-matching step.
    affected_vendor: atlasId,
    affected_cve: null
  };
}

// ---------------------------------------------------------------------------
// fetchMitreAtlasSignals  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch the MITRE ATLAS STIX bundle and return mapped signal inputs.
 *
 * Conditional GET semantics:
 *   - Sends `If-None-Match` with the cached ETag (Redis-backed) if present.
 *   - On HTTP 304 the upstream bundle is unchanged since the last fetch:
 *     returns `{ signals: [], total: 0, skipped: 0, fromCache: true }`
 *     without parsing a body.
 *   - On HTTP 200 captures the response `ETag` header for next call and
 *     proceeds with the existing parse + map pipeline.
 *
 * - Skips deprecated, revoked, and non-technique STIX objects.
 * - Does not validate against VALID_SOURCES / VALID_SIGNAL_TYPES — that is
 *   the ingest pipeline's responsibility.
 * - Throws on non-2xx-non-304 HTTP responses or malformed JSON so the caller
 *   can handle them.
 *
 * @returns { signals, total, skipped, fromCache }
 *   total    = raw STIX object count in the bundle (0 on cache hit)
 *   skipped  = count of objects filtered out (0 on cache hit)
 *   fromCache = true when the upstream returned 304 Not Modified
 */
export async function fetchMitreAtlasSignals(): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  skipped: number;
  fromCache: boolean;
}> {
  const cachedEtag = await getEtag(MITRE_ATLAS_ETAG_KEY);

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "SecureLogic-AI/1.0 (MITRE ATLAS Adapter)"
  };
  if (cachedEtag) {
    headers["If-None-Match"] = cachedEtag;
  }

  const response = await fetch(MITRE_ATLAS_BUNDLE_URL, { headers });

  // 304 Not Modified — bundle unchanged since the cached ETag was issued.
  // Skip the parse entirely and signal the caller via fromCache.
  if (response.status === 304) {
    return { signals: [], total: 0, skipped: 0, fromCache: true };
  }

  if (!response.ok) {
    throw new Error(
      `MITRE ATLAS fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const bundle = (await response.json()) as StixBundle;

  if (!Array.isArray(bundle.objects)) {
    throw new Error(
      "MITRE ATLAS bundle malformed: objects array missing"
    );
  }

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;

  for (const obj of bundle.objects) {
    const mapped = mapAtlasObjectToSignal(obj);
    if (mapped === null) {
      skipped++;
      continue;
    }
    signals.push(mapped);
  }

  // Persist the new ETag for next call. Best-effort: a Redis failure here
  // does not propagate — the next call will simply do an unconditional fetch.
  const newEtag = response.headers.get("etag");
  if (newEtag) {
    await setEtag(MITRE_ATLAS_ETAG_KEY, newEtag);
  }

  return {
    signals,
    total: bundle.objects.length,
    skipped,
    fromCache: false
  };
}
