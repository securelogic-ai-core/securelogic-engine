/**
 * mitreAttackAdapter.ts — MITRE ATT&CK STIX 2.1 signal adapter.
 *
 * Fetches the MITRE ATT&CK Enterprise dataset (STIX 2.1 bundle) from the
 * official GitHub release and maps selected object types to the platform's
 * CyberSignalIngestInput format for ingestion into the cyber_signals pipeline.
 *
 * DATA SOURCE
 * -----------
 * Official MITRE CTI GitHub repository — STIX 2.1 JSON bundle:
 *   https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json
 *
 * OBJECT TYPES EXTRACTED
 * ----------------------
 *   attack-pattern  → technique or sub-technique (signal_type: 'vulnerability')
 *   intrusion-set   → threat actor group        (signal_type: 'threat_actor')
 *   malware         → malware family            (signal_type: 'malware')
 *   tool            → adversary tool            (signal_type: 'malware')
 *
 * Deprecated and revoked objects are skipped (x_mitre_deprecated, x_mitre_revoked).
 * Objects lacking an ATT&CK external_id (T1234, G0001, S0001) are skipped.
 *
 * SEVERITY HEURISTIC
 * ------------------
 * ATT&CK does not carry CVSS scores. Severity is derived from object type and
 * kill chain phase as a proxy for technique prevalence and impact potential:
 *
 *   attack-pattern with kill chain phase 'impact'                  → Critical
 *   attack-pattern with kill chain phase 'initial-access'
 *                              or 'execution'                      → High
 *   attack-pattern that is a sub-technique (x_mitre_is_subtechnique) → Moderate
 *   attack-pattern (default)                                        → High
 *   intrusion-set (threat groups)                                   → High
 *   malware                                                         → High
 *   tool                                                            → Moderate
 *
 * DEDUPLICATION KEY
 * -----------------
 * The platform's dedup_hash is built from:
 *   source | signal_type | affected_cve | affected_vendor
 *
 * For ATT&CK signals there is no CVE. The ATT&CK external ID (T1566, G0001,
 * S0001 etc.) is stored in affected_vendor to serve as the dedup discriminator.
 * This ensures each ATT&CK object hashes to a unique key. The short alphanumeric
 * format of ATT&CK IDs (never resembling a real vendor name) prevents false
 * positive matches in the vendor-matching step of processSignal().
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * extractAttackId()         — pure, no I/O.
 * deriveAttackSeverity()    — pure, no I/O.
 * buildAttackSummary()      — pure, no I/O.
 * mapStixObjectToSignal()   — pure, no I/O; fully unit-testable.
 * fetchMitreAttackSignals() — performs the HTTP fetch, calls mapStixObjectToSignal.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";
import { getEtag, setEtag } from "./feedEtagStore.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MITRE_ATTACK_BUNDLE_URL =
  "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json";

/** Redis key holding the most recently observed ETag for the ATT&CK bundle. */
export const MITRE_ATTACK_ETAG_KEY = "mitre:attack:etag";

/** Object types extracted from the ATT&CK bundle. */
export const ATTACK_OBJECT_TYPES = new Set([
  "attack-pattern",
  "intrusion-set",
  "malware",
  "tool"
]);

/** Kill chain phase names (ATT&CK uses 'mitre-attack' kill chain). */
const HIGH_SEVERITY_PHASES = new Set(["initial-access", "execution"]);
const CRITICAL_SEVERITY_PHASES = new Set(["impact"]);

// ---------------------------------------------------------------------------
// STIX types
// ---------------------------------------------------------------------------

export type StixExternalReference = {
  source_name: string;
  external_id?: string;
  url?: string;
  description?: string;
};

export type StixKillChainPhase = {
  kill_chain_name: string;
  phase_name: string;
};

export type StixObject = {
  id: string;
  type: string;
  name?: string;
  description?: string;
  external_references?: StixExternalReference[];
  x_mitre_deprecated?: boolean;
  x_mitre_revoked?: boolean;
  x_mitre_is_subtechnique?: boolean;
  kill_chain_phases?: StixKillChainPhase[];
};

export type StixBundle = {
  type: string;
  id: string;
  objects: StixObject[];
};

// ---------------------------------------------------------------------------
// extractAttackId
// ---------------------------------------------------------------------------

/**
 * Extract the ATT&CK external ID (T1234, T1234.001, G0001, S0001, etc.)
 * from a STIX object's external_references array.
 *
 * Returns null if no 'mitre-attack' reference with an external_id is found.
 */
export function extractAttackId(obj: StixObject): string | null {
  if (!Array.isArray(obj.external_references)) return null;

  for (const ref of obj.external_references) {
    if (ref.source_name === "mitre-attack" && ref.external_id) {
      return ref.external_id.trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// deriveAttackSeverity
// ---------------------------------------------------------------------------

/**
 * Derive a platform severity label from an ATT&CK STIX object.
 *
 * Severity is a proxy for technique prevalence and impact potential since
 * ATT&CK data does not include CVSS or quantitative prevalence scores.
 *
 * Priority order:
 *   1. tool                                → Moderate
 *   2. attack-pattern + impact phase       → Critical
 *   3. attack-pattern + sub-technique flag → Moderate
 *   4. attack-pattern + high-severity phase → High
 *   5. All others (incl. intrusion-set, malware) → High
 */
export function deriveAttackSeverity(
  obj: StixObject
): "Critical" | "High" | "Moderate" | "Low" {
  if (obj.type === "tool") return "Moderate";

  if (obj.type === "attack-pattern") {
    const phases = obj.kill_chain_phases ?? [];
    const phaseNames = phases
      .filter((p) => p.kill_chain_name === "mitre-attack")
      .map((p) => p.phase_name);

    // Critical: technique appears in the impact phase
    if (phaseNames.some((p) => CRITICAL_SEVERITY_PHASES.has(p))) return "Critical";

    // Moderate: sub-techniques are more specific and generally harder to execute
    if (obj.x_mitre_is_subtechnique === true) return "Moderate";

    // High: initial-access or execution phases represent significant risk
    if (phaseNames.some((p) => HIGH_SEVERITY_PHASES.has(p))) return "High";

    return "High";
  }

  // intrusion-set, malware → High
  return "High";
}

// ---------------------------------------------------------------------------
// buildAttackSummary
// ---------------------------------------------------------------------------

/**
 * Build a normalized summary for an ATT&CK STIX object.
 *
 * Format: "<type-prefix>: <name> — <truncated description>"
 * Total capped at 500 characters to match platform normalizer limits.
 */
export function buildAttackSummary(obj: StixObject, attackId: string): string {
  const nameRaw = obj.name?.trim() ?? "";
  const descRaw = obj.description?.trim() ?? "";

  const typeLabel: Record<string, string> = {
    "attack-pattern": "Technique",
    "intrusion-set": "Threat Group",
    "malware": "Malware",
    "tool": "Tool"
  };
  const label = typeLabel[obj.type] ?? obj.type;

  const namePart = nameRaw ? `${label} ${attackId}: ${nameRaw}` : `${label} ${attackId}`;

  if (!descRaw) return namePart.length > 500 ? `${namePart.slice(0, 497)}...` : namePart;

  const truncatedDesc = descRaw.length > 300 ? `${descRaw.slice(0, 297)}...` : descRaw;
  const full = `${namePart} — ${truncatedDesc}`;

  return full.length > 500 ? `${full.slice(0, 497)}...` : full;
}

// ---------------------------------------------------------------------------
// mapStixObjectToSignal  (pure)
// ---------------------------------------------------------------------------

/**
 * Map a single ATT&CK STIX object to a CyberSignalIngestInput.
 *
 * Returns null when the object should be skipped:
 *   - Object type not in ATTACK_OBJECT_TYPES
 *   - Deprecated (x_mitre_deprecated: true)
 *   - Revoked (x_mitre_revoked: true)
 *   - No extractable ATT&CK external ID
 *   - No name (cannot build a meaningful signal)
 *
 * The ATT&CK external ID is stored in affected_vendor so the platform's
 * SHA-256 dedup hash (source|signal_type|affected_cve|affected_vendor)
 * produces a unique key per ATT&CK object.
 */
export function mapStixObjectToSignal(
  obj: StixObject
): CyberSignalIngestInput | null {
  // Skip non-target object types
  if (!ATTACK_OBJECT_TYPES.has(obj.type)) return null;

  // Skip deprecated and revoked entries
  if (obj.x_mitre_deprecated === true) return null;
  if (obj.x_mitre_revoked === true) return null;

  // Must have an ATT&CK external ID for dedup and traceability
  const attackId = extractAttackId(obj);
  if (attackId === null) return null;

  // Must have a name to produce a meaningful signal
  if (!obj.name?.trim()) return null;

  const signalType: string =
    obj.type === "intrusion-set"
      ? "threat_actor"
      : obj.type === "attack-pattern"
      ? "vulnerability"
      : "malware"; // malware + tool both map to 'malware' signal type

  const severity = deriveAttackSeverity(obj);
  const normalizedSummary = buildAttackSummary(obj, attackId);

  const rawPayload: Record<string, unknown> = {
    stix_id: obj.id,
    stix_type: obj.type,
    attack_id: attackId,
    name: obj.name?.trim() ?? null,
    description: obj.description ?? null,
    is_subtechnique: obj.x_mitre_is_subtechnique ?? false,
    kill_chain_phases: obj.kill_chain_phases ?? [],
    external_references: obj.external_references ?? []
  };

  return {
    source: "mitre_attack",
    signal_type: signalType,
    severity,
    raw_payload: rawPayload,
    normalized_summary: normalizedSummary,
    // ATT&CK ID in affected_vendor serves as the per-object dedup discriminator.
    // Short alphanumeric format (T1566, G0001) never matches real vendor names.
    affected_vendor: attackId,
    affected_cve: null
  };
}

// ---------------------------------------------------------------------------
// fetchMitreAttackSignals  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch the MITRE ATT&CK Enterprise STIX bundle and return mapped signal inputs.
 *
 * Conditional GET semantics:
 *   - Sends `If-None-Match` with the cached ETag (Redis-backed) if present.
 *   - On HTTP 304 the upstream bundle is unchanged since the last fetch:
 *     returns `{ signals: [], total: 0, skipped: 0, fromCache: true }`
 *     without parsing a body.
 *   - On HTTP 200 captures the response `ETag` header for next call and
 *     proceeds with the existing parse + map pipeline.
 *
 * - Skips deprecated, revoked, and unidentified objects.
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
export async function fetchMitreAttackSignals(): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  skipped: number;
  fromCache: boolean;
}> {
  const cachedEtag = await getEtag(MITRE_ATTACK_ETAG_KEY);

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "SecureLogic-AI/1.0 (MITRE ATT&CK Adapter)"
  };
  if (cachedEtag) {
    headers["If-None-Match"] = cachedEtag;
  }

  const response = await fetch(MITRE_ATTACK_BUNDLE_URL, { headers });

  // 304 Not Modified — bundle unchanged since the cached ETag was issued.
  // Skip the parse entirely and signal the caller via fromCache.
  if (response.status === 304) {
    return { signals: [], total: 0, skipped: 0, fromCache: true };
  }

  if (!response.ok) {
    throw new Error(
      `MITRE ATT&CK fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const bundle = (await response.json()) as StixBundle;

  if (!Array.isArray(bundle.objects)) {
    throw new Error(
      "MITRE ATT&CK bundle malformed: objects array missing"
    );
  }

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;

  for (const obj of bundle.objects) {
    const mapped = mapStixObjectToSignal(obj);
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
    await setEtag(MITRE_ATTACK_ETAG_KEY, newEtag);
  }

  return {
    signals,
    total: bundle.objects.length,
    skipped,
    fromCache: false
  };
}
