/**
 * outcomeMaterializer.ts — VA-S4-4C-3. Landing Layer 1 and Layer 3 for one
 * document.
 *
 * Runs at APPROVAL, alongside 20261073's tested-control resolution, for the same
 * reason and under the same discipline: approval is the moment the document
 * becomes the version of record, and a materialization failure must never fail
 * an approval a human already made and the database already committed.
 *
 * ── LAYER 2 IS NOT MATERIALIZED, and its absence here is the design ────────
 *
 * There is no code in this file that writes `vendor_tested_control_effectiveness`
 * and there will not be. Governed effectiveness is a human determination; the
 * only writer is the acceptance route, and it refuses an unattributed caller
 * before it writes. A materializer that seeded Layer 2 — with any value, however
 * conservative — would mean the platform held a governed effectiveness nobody
 * decided, which is precisely the failure the layering exists to prevent.
 *
 * Absence of a Layer-2 row means effectiveness is NOT ESTABLISHED. That is the
 * correct reading and the fail-closed one.
 *
 * ── IDEMPOTENT BY CONTENT, not by blanket supersession ─────────────────────
 *
 * 20261073 supersedes its whole live set on every run, which is right for it:
 * nothing there carries human authority, so re-running costs only history noise.
 *
 * Layer 3 is different. An exception row CARRIES A HUMAN INTERPRETATION
 * (`governed_effect`). Blanket supersession would mean that re-approving a
 * document, or re-running a recovery after a failure, silently discards every
 * exception interpretation a reviewer ever made and leaves the live state
 * uninterpreted. Fail-closed, but destructive and invisible.
 *
 * So both layers are idempotent BY CONTENT: a live row whose source content is
 * unchanged is LEFT ALONE, keeping its interpretation and its timestamps. A row
 * whose content actually changed is superseded and re-appended — and its
 * interpretation correctly does not carry over, because it was an interpretation
 * of different words.
 */

import { createHash } from "node:crypto";
import {
  proposeAuditorAssertion,
  parseExceptions,
  type ParsedException,
} from "./testedControlOutcome.js";
import {
  computeEffectiveTestedControls,
  resolutionFrameworkForDocumentType,
  type EffectiveTestedControl,
} from "./testedControlResolution.js";

type ClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type OutcomeMaterializationOutcome =
  | { ok: false; reason: "no_extraction" | "framework_not_resolvable"; detail?: Record<string, unknown> }
  | {
      ok: true;
      extraction_id: string;
      assertions_written: number;
      assertions_unchanged: number;
      assertions_superseded: number;
      assertion_counts: Record<string, number>;
      exceptions_written: number;
      exceptions_unchanged: number;
      exceptions_superseded: number;
      exception_links_written: number;
      /**
       * Exceptions whose linked control identifiers name no tested control in
       * the effective set. Surfaced, never dropped: an exception that cannot
       * reach a control is a gap somebody has to see.
       */
      exception_links_without_tested_control: string[];
      unidentified_control_count: number;
    };

const fingerprint = (parts: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** The auditor's verbatim result for one effective tested control. */
function resultTextOf(control: EffectiveTestedControl): string | null {
  const raw = (control.effective_control as Record<string, unknown>)["result"];
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

function exceptionFingerprint(ex: ParsedException): string {
  return fingerprint([
    ex.exception_ref,
    ex.description,
    ex.auditor_assessment,
    ex.source_term,
    ex.links.map((l) => [l.control_ref, l.link_source, l.source_value]).sort(),
  ]);
}

/**
 * Materialise Layer 1 and Layer 3 for one document.
 *
 * The caller supplies the client so this can join an existing transaction. It
 * does not open one: whether materialization shares the approval's transaction
 * is the caller's decision, not this function's.
 */
export async function materializeTestedControlOutcomes(
  client: ClientLike,
  args: { organizationId: string; documentId: string }
): Promise<OutcomeMaterializationOutcome> {
  const doc = await client.query(
    `SELECT d.document_type_hint, e.id AS extraction_id, e.fields
       FROM vendor_assurance_documents d
       LEFT JOIN vendor_assurance_extractions e ON e.document_id = d.id
      WHERE d.id = $1 AND d.organization_id = $2
      LIMIT 1`,
    [args.documentId, args.organizationId]
  );
  const row = doc.rows[0];
  if (row === undefined || row.extraction_id === null) return { ok: false, reason: "no_extraction" };

  // The SAME closed framework gate 20261073 uses. A SOC 1 report's identifiers
  // look like TSC criteria and are not, and an assertion recorded against the
  // wrong framework's controls is worse than no assertion.
  const framework = resolutionFrameworkForDocumentType(row.document_type_hint ?? null);
  if (framework === null) {
    return {
      ok: false,
      reason: "framework_not_resolvable",
      detail: { document_type_hint: row.document_type_hint ?? null },
    };
  }
  const extractionId: string = row.extraction_id;
  const fields = (row.fields ?? {}) as Record<string, { value?: unknown } | undefined>;

  const liveOverride = async (fieldName: string) => {
    const r = await client.query(
      `SELECT id, override_value
         FROM vendor_assurance_field_overrides
        WHERE document_id = $1 AND organization_id = $2 AND field_name = $3
        ORDER BY overridden_at DESC, id DESC
        LIMIT 1`,
      [args.documentId, args.organizationId, fieldName]
    );
    return (r.rows[0] ?? null) as { id: string; override_value: unknown } | null;
  };

  /* ── LAYER 1 ──────────────────────────────────────────────────────────── */

  const controlsOverride = await liveOverride("controls");
  const effective = computeEffectiveTestedControls({
    extractionControls: fields["controls"]?.value,
    liveOverride: controlsOverride,
  });

  const liveAssertions = await client.query(
    `SELECT id, element_key, auditor_assertion, source_text, effective_source, override_id
       FROM vendor_tested_control_assertions
      WHERE extraction_id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
    [extractionId, args.organizationId]
  );
  const liveAssertionByKey = new Map<string, any>(liveAssertions.rows.map((r) => [r.element_key, r]));

  let assertionsWritten = 0;
  let assertionsUnchanged = 0;
  let assertionsSuperseded = 0;
  const assertionCounts: Record<string, number> = {};
  const keptAssertionKeys = new Set<string>();

  for (const control of effective.controls) {
    const sourceText = resultTextOf(control);
    const proposal = proposeAuditorAssertion(sourceText);
    assertionCounts[proposal.candidate] = (assertionCounts[proposal.candidate] ?? 0) + 1;

    const existing = liveAssertionByKey.get(control.element_key);
    const unchanged =
      existing !== undefined &&
      existing.auditor_assertion === proposal.candidate &&
      (existing.source_text ?? null) === sourceText &&
      existing.effective_source === control.effective_source &&
      (existing.override_id ?? null) === control.override_id;

    if (unchanged) {
      assertionsUnchanged += 1;
      keptAssertionKeys.add(control.element_key);
      continue;
    }

    if (existing !== undefined) {
      await client.query(
        `UPDATE vendor_tested_control_assertions SET superseded_at = NOW() WHERE id = $1`,
        [existing.id]
      );
      assertionsSuperseded += 1;
    }
    keptAssertionKeys.add(control.element_key);

    await client.query(
      `INSERT INTO vendor_tested_control_assertions
         (organization_id, document_id, extraction_id, element_key, auditor_assertion,
          source_text, effective_source, override_id, source_term,
          normalizer_version, normalizer_rule, normalizer_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        args.organizationId,
        args.documentId,
        extractionId,
        control.element_key,
        proposal.candidate,
        sourceText,
        control.effective_source,
        control.override_id,
        // Terminology only, and only where the auditor actually used one of the
        // two words. Never a severity, never inferred.
        proposal.candidate === "EXCEPTION_NOTED"
          ? "exception"
          : proposal.candidate === "DEVIATION_NOTED"
            ? "deviation"
            : null,
        proposal.normalizer_version,
        proposal.rule,
        proposal.reason,
      ]
    );
    assertionsWritten += 1;
  }

  // A control an override REMOVED is not a tested control any more, so its live
  // assertion must stop being current — the same reasoning as 20261073.
  for (const [key, existing] of liveAssertionByKey) {
    if (keptAssertionKeys.has(key)) continue;
    await client.query(
      `UPDATE vendor_tested_control_assertions SET superseded_at = NOW() WHERE id = $1`,
      [existing.id]
    );
    assertionsSuperseded += 1;
  }

  /* ── LAYER 3 ──────────────────────────────────────────────────────────── */

  const exceptionsOverride = await liveOverride("exceptions");
  const exceptionsValue =
    exceptionsOverride !== null ? exceptionsOverride.override_value : fields["exceptions"]?.value;
  const effectiveExceptionSource: "extraction" | "field_override" =
    exceptionsOverride !== null ? "field_override" : "extraction";
  const parsed = parseExceptions(exceptionsValue);

  const liveExceptions = await client.query(
    `SELECT e.id, e.source_ordinal, e.exception_ref, e.description, e.auditor_assessment,
            e.source_term, e.governed_effect,
            COALESCE(
              json_agg(json_build_object(
                'control_ref', l.element_key,
                'link_source', l.link_source,
                'source_value', l.source_value
              ) ORDER BY l.element_key) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS links
       FROM vendor_assurance_exceptions e
       LEFT JOIN vendor_assurance_exception_controls l ON l.exception_id = e.id
      WHERE e.extraction_id = $1 AND e.organization_id = $2 AND e.superseded_at IS NULL
      GROUP BY e.id`,
    [extractionId, args.organizationId]
  );
  const liveExceptionByOrdinal = new Map<number, any>(
    liveExceptions.rows.map((r) => [r.source_ordinal, r])
  );

  let exceptionsWritten = 0;
  let exceptionsUnchanged = 0;
  let exceptionsSuperseded = 0;
  let linksWritten = 0;
  const keptOrdinals = new Set<number>();
  const testedKeys = new Set(effective.controls.map((c) => c.element_key.toLowerCase()));
  const orphanLinks = new Set<string>();

  for (const ex of parsed) {
    for (const l of ex.links) {
      if (!testedKeys.has(l.control_ref.toLowerCase())) orphanLinks.add(l.control_ref);
    }

    const existing = liveExceptionByOrdinal.get(ex.ordinal);
    const incoming = exceptionFingerprint(ex);
    const current =
      existing === undefined
        ? null
        : fingerprint([
            existing.exception_ref,
            existing.description,
            existing.auditor_assessment,
            existing.source_term,
            (existing.links as Array<Record<string, string>>)
              .map((l) => [l["control_ref"], l["link_source"], l["source_value"]])
              .sort(),
          ]);

    if (current !== null && current === incoming) {
      // Unchanged. LEAVE IT ALONE — this is what preserves a human's
      // governed_effect across a re-approval or a recovery re-run.
      exceptionsUnchanged += 1;
      keptOrdinals.add(ex.ordinal);
      continue;
    }

    if (existing !== undefined) {
      await client.query(
        `UPDATE vendor_assurance_exceptions SET superseded_at = NOW() WHERE id = $1`,
        [existing.id]
      );
      exceptionsSuperseded += 1;
    }
    keptOrdinals.add(ex.ordinal);

    const ins = await client.query(
      `INSERT INTO vendor_assurance_exceptions
         (organization_id, document_id, extraction_id, exception_ref, source_ordinal,
          description, auditor_assessment, source_term, effective_source, override_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        args.organizationId,
        args.documentId,
        extractionId,
        ex.exception_ref,
        ex.ordinal,
        // An exception with no description at all cannot satisfy the NOT-empty
        // CHECK; it is recorded with an explicit marker rather than skipped,
        // because a silently dropped exception is the worst outcome available.
        ex.description.length > 0 ? ex.description : "(the extraction recorded no description)",
        ex.auditor_assessment,
        ex.source_term,
        effectiveExceptionSource,
        exceptionsOverride?.id ?? null,
      ]
    );
    const exceptionId = ins.rows[0]!.id;
    exceptionsWritten += 1;

    for (const l of ex.links) {
      await client.query(
        `INSERT INTO vendor_assurance_exception_controls
           (organization_id, exception_id, element_key, link_source, source_value)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (exception_id, element_key) DO NOTHING`,
        [args.organizationId, exceptionId, l.control_ref, l.link_source, l.source_value]
      );
      linksWritten += 1;
    }
  }

  for (const [ordinal, existing] of liveExceptionByOrdinal) {
    if (keptOrdinals.has(ordinal)) continue;
    await client.query(
      `UPDATE vendor_assurance_exceptions SET superseded_at = NOW() WHERE id = $1`,
      [existing.id]
    );
    exceptionsSuperseded += 1;
  }

  return {
    ok: true,
    extraction_id: extractionId,
    assertions_written: assertionsWritten,
    assertions_unchanged: assertionsUnchanged,
    assertions_superseded: assertionsSuperseded,
    assertion_counts: assertionCounts,
    exceptions_written: exceptionsWritten,
    exceptions_unchanged: exceptionsUnchanged,
    exceptions_superseded: exceptionsSuperseded,
    exception_links_written: linksWritten,
    exception_links_without_tested_control: [...orphanLinks].sort(),
    unidentified_control_count: effective.unidentified_count,
  };
}
