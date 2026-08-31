/**
 * testedControlResolution.ts — VA-S4-4C-2.
 *
 * Resolves a vendor assurance document's tested controls to canonical controls
 * through the GOVERNED canonical crosswalk published by 4C-1, and records what
 * it resolved, against which mapping, from which value.
 *
 * ── The three rules this file exists to hold ───────────────────────────────
 *
 * 1. GOVERNED EFFECTIVE VALUE, not just the extraction. Field overrides are
 *    append-only rows BESIDE the extraction and never rewrite
 *    `vendor_assurance_extractions.fields` (measured in 4C-0). Anything that
 *    reads `fields` alone silently ignores every human correction ever made.
 *    The effective value is the live override's when one exists, else the
 *    extraction's — and BOTH are recorded.
 *
 * 2. NO SILENT DROPS. Every tested control in the effective set produces a row:
 *    `resolved` with its canonical control and the mapping row that justified
 *    it, or `unmapped` with a reason. Controls that cannot be recorded at all —
 *    one with no identifier — are COUNTED and returned, never skipped quietly.
 *
 * 3. NO INFERENCE. The only route from a TSC criterion to a canonical control
 *    is a published crosswalk row. No string similarity, no prefix matching, no
 *    "close enough" family fallback. An identity the crosswalk does not carry
 *    is `unmapped`, visibly.
 *
 * ── What a resolution asserts ──────────────────────────────────────────────
 *
 * That a tested control carries a valid canonical identity which a governed
 * mapping connects to a canonical control. NOTHING about tenant applicability,
 * requirement applicability, evidence sufficiency, control effectiveness,
 * questionnaire suppression or residual risk.
 */

/** The framework identity a SOC 2 document's tested controls are read against. */
export const SOC2_RESOLUTION_FRAMEWORK = { key: "soc2", version: "2017" } as const;

/**
 * Which document type hints may be resolved against which framework identity.
 *
 * Deliberately explicit and closed. A SOC 1 report's control identifiers look
 * like SOC 2 criteria to a naive reader, and resolving them against the TSC
 * would attach one framework's meaning to another framework's evidence — the
 * exact failure `canonical_control_crosswalk` is versioned to prevent.
 */
export function resolutionFrameworkForDocumentType(
  documentTypeHint: string | null
): { key: string; version: string } | null {
  if (documentTypeHint === "soc2_type1" || documentTypeHint === "soc2_type2") {
    return { key: SOC2_RESOLUTION_FRAMEWORK.key, version: SOC2_RESOLUTION_FRAMEWORK.version };
  }
  return null;
}

export type TestedControl = Record<string, unknown>;

export type EffectiveTestedControl = {
  element_key: string;
  /** NULL only when an override introduced a control the extraction never had. */
  original_control: TestedControl | null;
  effective_control: TestedControl;
  effective_source: "extraction" | "field_override";
  override_id: string | null;
};

export type EffectiveSet = {
  controls: EffectiveTestedControl[];
  /**
   * Controls carrying no usable identifier. They cannot be recorded — an array
   * index is not an identity, and keying on one would re-point a governance
   * decision at a different control the moment the array changed — so they are
   * surfaced as a count rather than dropped.
   */
  unidentified_count: number;
  /** Element keys the extraction had and a live override REMOVED. */
  removed_by_override: string[];
};

function keyOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = (entry as Record<string, unknown>)["control_id"];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function indexByKey(value: unknown): { byKey: Map<string, TestedControl>; unidentified: number } {
  const byKey = new Map<string, TestedControl>();
  let unidentified = 0;
  if (!Array.isArray(value)) return { byKey, unidentified };
  for (const entry of value) {
    const key = keyOf(entry);
    if (key === null) {
      unidentified += 1;
      continue;
    }
    // First occurrence wins, matching `testedControlKeysOf`'s de-duplication.
    if (!byKey.has(key)) byKey.set(key, entry as TestedControl);
  }
  return { byKey, unidentified };
}

/**
 * The governed effective tested-control set.
 *
 * Pairing is by the extracted control IDENTIFIER, never by array position: an
 * override rewrites the whole array, and position would silently re-point a
 * control at a different one — the same reasoning that keyed 20261072's review
 * decisions on the identifier.
 */
export function computeEffectiveTestedControls(args: {
  extractionControls: unknown;
  liveOverride: { id: string; override_value: unknown } | null;
}): EffectiveSet {
  const original = indexByKey(args.extractionControls);

  if (args.liveOverride === null) {
    return {
      controls: [...original.byKey.entries()].map(([element_key, control]) => ({
        element_key,
        original_control: control,
        effective_control: control,
        effective_source: "extraction",
        override_id: null,
      })),
      unidentified_count: original.unidentified,
      removed_by_override: [],
    };
  }

  const overridden = indexByKey(args.liveOverride.override_value);
  const controls: EffectiveTestedControl[] = [];
  for (const [element_key, control] of overridden.byKey) {
    controls.push({
      element_key,
      original_control: original.byKey.get(element_key) ?? null,
      effective_control: control,
      effective_source: "field_override",
      override_id: args.liveOverride.id,
    });
  }
  const removed = [...original.byKey.keys()].filter((k) => !overridden.byKey.has(k));
  return {
    controls,
    // An override that introduces an unidentifiable control is the override's
    // problem, and it is counted the same way the extraction's would be.
    unidentified_count: overridden.unidentified,
    removed_by_override: removed,
  };
}

/** A published crosswalk row, as the resolver needs it. */
export type CrosswalkMapping = {
  id: string;
  requirement_reference: string;
  canonical_control_id: string;
  mapping_version: string;
  mapping_source: string;
};

export type Resolution = EffectiveTestedControl & {
  requirement_reference: string;
  resolution_state: "resolved" | "unmapped";
  canonical_control_id: string | null;
  crosswalk_id: string | null;
  mapping_version: string | null;
  mapping_source: string | null;
  unmapped_reason: "no_published_crosswalk_mapping" | null;
};

/**
 * Resolve the effective set against published mappings.
 *
 * FAN-OUT, NOT AMBIGUITY: a criterion carrying several canonical controls
 * yields several `resolved` rows. That is the crosswalk working as designed —
 * CC6.1 legitimately carries eight — and it is not an unresolved identity.
 */
export function resolveTestedControls(
  effective: readonly EffectiveTestedControl[],
  mappings: readonly CrosswalkMapping[]
): Resolution[] {
  const byReference = new Map<string, CrosswalkMapping[]>();
  for (const m of mappings) {
    const list = byReference.get(m.requirement_reference);
    if (list === undefined) byReference.set(m.requirement_reference, [m]);
    else list.push(m);
  }

  const out: Resolution[] = [];
  for (const control of effective) {
    // The tested control's identifier IS the criterion reference. Exact match
    // only — no normalisation beyond the trim already applied, because a
    // near-match is a different criterion.
    const reference = control.element_key;
    const found = byReference.get(reference) ?? [];
    if (found.length === 0) {
      out.push({
        ...control,
        requirement_reference: reference,
        resolution_state: "unmapped",
        canonical_control_id: null,
        crosswalk_id: null,
        mapping_version: null,
        mapping_source: null,
        unmapped_reason: "no_published_crosswalk_mapping",
      });
      continue;
    }
    for (const m of found) {
      out.push({
        ...control,
        requirement_reference: reference,
        resolution_state: "resolved",
        canonical_control_id: m.canonical_control_id,
        crosswalk_id: m.id,
        mapping_version: m.mapping_version,
        mapping_source: m.mapping_source,
        unmapped_reason: null,
      });
    }
  }
  return out;
}

/* =========================================================================
   The materializer.
   ========================================================================= */

type ClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type MaterializationOutcome =
  | { ok: false; reason: "no_extraction" | "framework_not_resolvable"; detail?: Record<string, unknown> }
  | {
      ok: true;
      extraction_id: string;
      framework_key: string;
      framework_version: string;
      effective_source: "extraction" | "field_override";
      resolved: number;
      unmapped: number;
      unmapped_references: string[];
      superseded: number;
      unidentified_count: number;
      removed_by_override: string[];
    };

/**
 * Materialise the resolution record for one document.
 *
 * IDEMPOTENT BY SUPERSESSION, never by mutation: every live row for the
 * extraction is stamped `superseded_at` and the current answer is appended.
 * Re-running against unchanged inputs therefore produces an identical current
 * set with an honest history behind it, and a row whose mapping has since been
 * superseded stays readable as the answer that WAS given.
 *
 * The caller supplies the client so this can join an existing transaction. It
 * does not open one: whether resolution shares the approval's transaction is
 * the caller's decision, not this function's.
 */
export async function materializeTestedControlResolutions(
  client: ClientLike,
  args: { organizationId: string; documentId: string }
): Promise<MaterializationOutcome> {
  const doc = await client.query(
    `SELECT d.document_type_hint, e.id AS extraction_id, e.fields
       FROM vendor_assurance_documents d
       LEFT JOIN vendor_assurance_extractions e ON e.document_id = d.id
      WHERE d.id = $1 AND d.organization_id = $2
      LIMIT 1`,
    [args.documentId, args.organizationId]
  );
  const row = doc.rows[0];
  if (row === undefined || row.extraction_id === null) {
    return { ok: false, reason: "no_extraction" };
  }

  const framework = resolutionFrameworkForDocumentType(row.document_type_hint ?? null);
  if (framework === null) {
    // Surfaced, never guessed. A SOC 1 report's identifiers must not be read
    // against the Trust Services Criteria.
    return {
      ok: false,
      reason: "framework_not_resolvable",
      detail: { document_type_hint: row.document_type_hint ?? null },
    };
  }

  const override = await client.query(
    `SELECT id, override_value
       FROM vendor_assurance_field_overrides
      WHERE document_id = $1 AND organization_id = $2 AND field_name = 'controls'
      ORDER BY overridden_at DESC, id DESC
      LIMIT 1`,
    [args.documentId, args.organizationId]
  );

  const effective = computeEffectiveTestedControls({
    extractionControls: (row.fields ?? {})["controls"]?.value,
    liveOverride: override.rows[0] ?? null,
  });

  const mappings = await client.query(
    `SELECT id, requirement_reference, canonical_control_id, mapping_version, mapping_source
       FROM canonical_control_crosswalk
      WHERE framework_key = $1 AND framework_version = $2
        AND status = 'published' AND superseded_at IS NULL`,
    [framework.key, framework.version]
  );

  const resolutions = resolveTestedControls(effective.controls, mappings.rows as CrosswalkMapping[]);

  // Supersede the whole live set first: a control removed by an override must
  // stop being current, and that cannot be expressed by upserting only what is
  // still present.
  const superseded = await client.query(
    `UPDATE vendor_tested_control_resolutions
        SET superseded_at = NOW()
      WHERE extraction_id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
    [row.extraction_id, args.organizationId]
  );

  for (const r of resolutions) {
    await client.query(
      `INSERT INTO vendor_tested_control_resolutions
         (organization_id, document_id, extraction_id, element_key,
          original_control, effective_control, effective_source, override_id,
          framework_key, framework_version, requirement_reference,
          canonical_control_id, crosswalk_id, mapping_version, mapping_source,
          resolution_state, unmapped_reason)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        args.organizationId,
        args.documentId,
        row.extraction_id,
        r.element_key,
        r.original_control === null ? null : JSON.stringify(r.original_control),
        JSON.stringify(r.effective_control),
        r.effective_source,
        r.override_id,
        framework.key,
        framework.version,
        r.requirement_reference,
        r.canonical_control_id,
        r.crosswalk_id,
        r.mapping_version,
        r.mapping_source,
        r.resolution_state,
        r.unmapped_reason,
      ]
    );
  }

  const unmapped = resolutions.filter((r) => r.resolution_state === "unmapped");
  return {
    ok: true,
    extraction_id: row.extraction_id,
    framework_key: framework.key,
    framework_version: framework.version,
    effective_source: override.rows[0] ? "field_override" : "extraction",
    resolved: resolutions.length - unmapped.length,
    unmapped: unmapped.length,
    unmapped_references: [...new Set(unmapped.map((r) => r.requirement_reference))].sort(),
    superseded: superseded.rowCount ?? 0,
    unidentified_count: effective.unidentified_count,
    removed_by_override: effective.removed_by_override,
  };
}
