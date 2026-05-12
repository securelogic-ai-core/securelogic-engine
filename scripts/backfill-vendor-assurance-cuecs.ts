/**
 * backfill-vendor-assurance-cuecs.ts — one-time (idempotent) backfill for the
 * vendor-assurance-cuec-matcher package.
 *
 * For every vendor_assurance_documents row that has an extraction and whose
 * processing_status is past the in-flight stage (extracted / manual_review_
 * requested / approved / rejected / finalized), it:
 *   1. (re)builds the vendor_assurance_cuecs rows from the document's effective
 *      cuecs list (latest `cuecs` field-override if one exists, else the
 *      extraction's fields["cuecs"].value), and
 *   2. runs the LLM matcher against the org's active controls inventory,
 *      writing 'suggested' rows into vendor_assurance_cuec_control_mappings.
 *
 * Both steps go through refreshCuecMappingsForDocument({ resyncRows: true }) —
 * the same path the extraction runner uses — so re-running this script is safe:
 * the cuec rows are DELETE-then-INSERTed, and the matcher deletes only
 * 'suggested' mappings before re-inserting (any 'accepted' / 'dismissed' user
 * actions, and any 'reviewed_no_match' CUEC review state, survive a re-run only
 * if the cuec list itself is unchanged — a re-run with a changed list resets
 * everything for that document, by design).
 *
 * Read-only on vendor_assurance_extractions. Writes only to
 * vendor_assurance_cuecs and vendor_assurance_cuec_control_mappings.
 *
 * Usage — point DATABASE_URL at the env to backfill (STAGING first, then PROD
 * once promoted) and provide ANTHROPIC_API_KEY for the matcher:
 *
 *   DATABASE_URL='postgresql://...staging...' ANTHROPIC_API_KEY='sk-ant-...' \
 *     npx tsx scripts/backfill-vendor-assurance-cuecs.ts
 *
 * Optional first arg = a single document_id to backfill just that document.
 * If ANTHROPIC_API_KEY is absent the cuec rows are still written; the matcher
 * reports reason=llm_unavailable for those documents (re-run with the key, or
 * use the in-app Re-match button, to populate suggestions later).
 */

import "dotenv/config";
import { pg } from "../src/api/infra/postgres.js";
import { refreshCuecMappingsForDocument } from "../src/api/lib/vendorAssuranceCuecMatcher.js";

const ELIGIBLE_STATUSES = ["extracted", "manual_review_requested", "approved", "rejected", "finalized"];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run.");
    process.exit(1);
  }
  const onlyDocumentId = (process.argv[2] ?? "").trim() || null;

  const rows = onlyDocumentId
    ? (await pg.query<{ id: string; organization_id: string; processing_status: string }>(
        `SELECT d.id, d.organization_id, d.processing_status
           FROM vendor_assurance_documents d
           JOIN vendor_assurance_extractions e ON e.document_id = d.id AND e.organization_id = d.organization_id
          WHERE d.id = $1`,
        [onlyDocumentId]
      )).rows
    : (await pg.query<{ id: string; organization_id: string; processing_status: string }>(
        `SELECT d.id, d.organization_id, d.processing_status
           FROM vendor_assurance_documents d
           JOIN vendor_assurance_extractions e ON e.document_id = d.id AND e.organization_id = d.organization_id
          WHERE d.processing_status = ANY($1::text[])
          ORDER BY d.created_at ASC, d.id ASC`,
        [ELIGIBLE_STATUSES]
      )).rows;

  console.log(`[backfill-cuecs] ${rows.length} document(s) to process${onlyDocumentId ? ` (filtered to ${onlyDocumentId})` : ""}.`);

  let ok = 0;
  let withSuggestions = 0;
  let llmUnavailable = 0;
  let failed = 0;
  let totalCuecs = 0;
  let totalSuggestions = 0;

  for (let i = 0; i < rows.length; i++) {
    const d = rows[i]!;
    const tag = `[${i + 1}/${rows.length}] doc=${d.id} org=${d.organization_id} status=${d.processing_status}`;
    try {
      const result = await refreshCuecMappingsForDocument(d.id, d.organization_id, { resyncRows: true });
      ok++;
      totalCuecs += result.cuecCount;
      totalSuggestions += result.suggestionsWritten;
      if (result.suggestionsWritten > 0) withSuggestions++;
      if (result.reason === "llm_unavailable" || result.reason === "llm_failed") llmUnavailable++;
      console.log(
        `${tag} → cuecs=${result.cuecCount} controls=${result.controlCount} considered=${result.suggestionsConsidered} written=${result.suggestionsWritten}` +
          (result.matched ? "" : ` (no suggestions: ${result.reason})`)
      );
    } catch (err) {
      failed++;
      console.error(`${tag} → FAILED: ${(err as Error)?.message ?? "unknown error"}`);
    }
  }

  console.log(
    `[backfill-cuecs] done. processed=${rows.length} ok=${ok} failed=${failed} ` +
      `docsWithSuggestions=${withSuggestions} llmUnavailable=${llmUnavailable} ` +
      `cuecsTotal=${totalCuecs} suggestionsTotal=${totalSuggestions}`
  );

  await pg.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[backfill-cuecs] fatal:", err);
  try { await pg.end(); } catch { /* ignore */ }
  process.exit(1);
});
