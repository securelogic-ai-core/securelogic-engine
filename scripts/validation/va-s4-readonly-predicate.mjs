/**
 * va-s4-readonly-predicate.mjs — the READ-ONLY S4 validation predicate.
 *
 * VALIDATION ONLY. This does NOT change production S4 behaviour: nothing here
 * is imported by `scopeResolver.ts` or any request path, and it performs no
 * writes. It answers one question — "which requirements WOULD be assurance
 * covered, and where does the chain break?" — so the wiring-plan §7 gate can be
 * re-run without touching the product.
 *
 * ── Two corrections against the earlier predicate ──────────────────────────
 *
 * 1. LIFECYCLE. The old clause gated on `processing_status='finalized'`. Owner
 *    ruling 2026-08-30: **`approved` is the terminal assurance-eligible state**,
 *    and no new `finalized` state is to be introduced to satisfy a predicate.
 *    Verified against the canonical lifecycle before this rewrite:
 *      - `approved` is set ONLY by POST /vendor-assurance/documents/:id/approve,
 *        reachable only from `extracted`, never by a worker: the extraction path
 *        writes `extracting` / `extracted` / `extraction_failed` and nothing else;
 *      - it is documented in-route as "terminal-success / the version of record",
 *        with `finalized` marked legacy;
 *      - `pending`, `extracting`, `extracted`, `extraction_failed`,
 *        `manual_review_requested` and `rejected` are all excluded here.
 *    BUT the approval route is NOT gated on a user session (requireApiKey +
 *    entitlement + denyContributor only) and writes `req.userId ?? null`, while
 *    `vendor_assurance_documents_approved_consistency` requires only
 *    `approved_at NOT NULL AND status='approved'` — it does NOT require an
 *    approver. So `approved` is human-owned by CONVENTION, not by construction.
 *    **This predicate therefore requires `approved_by_user_id IS NOT NULL`**
 *    rather than trusting the status alone.
 *
 * 2. ROUTE. It joins the GOVERNED CANONICAL CROSSWALK, not `control_mappings`.
 *    On the proof org `control_mappings` reaches exactly one SYNTHETIC NIST CSF
 *    2.0 template-baseline umbrella requirement (`industry-template:*`), which
 *    is not a real framework requirement and must never be counted as coverage.
 *    The crosswalk reaches real NIST CSF 1.1 requirements.
 *
 * ── What it deliberately does NOT assert ───────────────────────────────────
 *
 * Evidence VALIDITY (Ruling 3). Report periods live in
 * `vendor_assurance_extractions.fields` JSONB, not columns, so a period rule is
 * not expressible in SQL today — that is the ADR-0012 subset, unbuilt. Silence
 * here is deliberate: the predicate does not claim validity it cannot check.
 *
 * Revocation. `vendor_assurance_documents` has NO revoked/superseded/deleted
 * column and no DELETE route, and field overrides are refused once `approved`.
 * Eligibility once granted is currently irreversible; there is nothing to
 * subtract, and this comment is the record of that gap.
 *
 * ── Why h7 cannot be nonzero today, and it is not this predicate's fault ───
 *
 * `vendor_assurance_documents.assurance_opinion` has **no writer anywhere in
 * the codebase**. Verified 2026-08-30 by exhaustive search: the column name
 * appears in exactly two files — `db/migrations/20261066_assurance_opinion.sql`
 * and `src/api/lib/vendorAssurance/assuranceOpinion.ts`, the latter only in a
 * comment saying so. VA-S4 Step 4 shipped the closed vocabulary,
 * `opinionCoverageGate`, the advisory proposal normalizer and the authority
 * CHECK that makes an opinion without a named acceptor impossible — but no
 * ACCEPTANCE SURFACE. So the final hop is unreachable through any product or
 * governance path, and the only way to satisfy it would be direct database
 * manipulation, which would make the whole run a fabrication.
 *
 * That is a BUILD gap, not a predicate defect. This script is written to report
 * it as a zero at h7 rather than to work around it.
 *
 * Run:  node scripts/validation/va-s4-readonly-predicate.mjs [--org <uuid>]
 */
import pg from "pg";

const ORG = (() => {
  const i = process.argv.indexOf("--org");
  return i === -1 ? null : process.argv[i + 1];
})();

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const orgFilter = ORG ? "= $1" : "IS NOT NULL";
const P = ORG ? [ORG] : [];

// The chain, as CTEs so each hop can be counted where it stands.
const CHAIN = `
WITH h1 AS (   -- applicable NIST CSF 1.1 requirement
  SELECT r.id AS requirement_id, r.reference_id, f.organization_id, f.framework_key, f.version
    FROM requirements r
    JOIN frameworks f ON f.id = r.framework_id
   WHERE f.organization_id ${orgFilter}
     AND f.framework_key = 'nist-csf' AND f.version = '1.1'
), h2 AS (     -- governed crosswalk: published, live, versioned identity
  SELECT h1.*, x.canonical_control_id, x.mapping_version, x.status AS crosswalk_status
    FROM h1
    JOIN canonical_control_crosswalk x
      ON x.framework_key = h1.framework_key
     AND x.framework_version = h1.version
     AND x.requirement_reference = h1.reference_id
     AND x.status = 'published'
     AND x.superseded_at IS NULL
), h3 AS (     -- canonical control, published only
  SELECT h2.*, cc.canonical_key
    FROM h2 JOIN canonical_controls cc
      ON cc.id = h2.canonical_control_id AND cc.status = 'published'
), h4 AS (     -- tenant control implementation, org-scoped at the hop
  SELECT h3.*, i.control_id, i.provenance
    FROM h3
    JOIN control_canonical_identities i
      ON i.canonical_control_id = h3.canonical_control_id
     AND i.organization_id = h3.organization_id
), h5 AS (     -- accepted CUEC mapping, never auto-only
  SELECT h4.*, m.cuec_id, m.mapping_source
    FROM h4
    JOIN vendor_assurance_cuec_control_mappings m
      ON m.control_id = h4.control_id
     AND m.organization_id = h4.organization_id
     AND m.mapping_status = 'accepted'
     AND m.mapping_source <> 'auto'
), h6 AS (     -- approved assurance document, with a NAMED approver
  SELECT h5.*, d.id AS document_id, d.vendor_id, d.assurance_opinion
    FROM h5
    JOIN vendor_assurance_cuecs cu
      ON cu.id = h5.cuec_id AND cu.organization_id = h5.organization_id
     AND cu.review_status = 'accepted'
    JOIN vendor_assurance_documents d
      ON d.id = cu.document_id AND d.organization_id = h5.organization_id
     AND d.processing_status = 'approved'
     AND d.approved_at IS NOT NULL
     AND d.approved_by_user_id IS NOT NULL
), h7 AS (     -- human-accepted opinion, resolving to 'eligible'
  SELECT h6.* FROM h6
   WHERE h6.assurance_opinion = 'unmodified'          -- opinionCoverageGate => eligible
     AND EXISTS (SELECT 1 FROM vendor_assurance_documents d2
                  WHERE d2.id = h6.document_id
                    AND d2.assurance_opinion_accepted_by_user_id IS NOT NULL
                    AND d2.assurance_opinion_accepted_at IS NOT NULL)
)`;

const hops = await q(`${CHAIN}
SELECT (SELECT count(DISTINCT requirement_id) FROM h1) AS h1_applicable_requirement,
       (SELECT count(DISTINCT requirement_id) FROM h2) AS h2_governed_crosswalk,
       (SELECT count(DISTINCT requirement_id) FROM h3) AS h3_canonical_control,
       (SELECT count(DISTINCT requirement_id) FROM h4) AS h4_tenant_control,
       (SELECT count(DISTINCT requirement_id) FROM h5) AS h5_accepted_cuec_mapping,
       (SELECT count(DISTINCT requirement_id) FROM h6) AS h6_approved_document,
       (SELECT count(DISTINCT requirement_id) FROM h7) AS h7_accepted_opinion_eligible`, P);

// Corpus context: why a hop is empty is usually a population fact.
const corpus = await q(`
SELECT (SELECT count(*) FROM vendor_assurance_documents WHERE organization_id ${orgFilter}) AS documents,
       (SELECT count(*) FROM vendor_assurance_documents WHERE organization_id ${orgFilter} AND processing_status='approved') AS approved,
       (SELECT count(*) FROM vendor_assurance_documents WHERE organization_id ${orgFilter} AND approved_by_user_id IS NOT NULL) AS approved_named_human,
       (SELECT count(*) FROM vendor_assurance_documents WHERE organization_id ${orgFilter} AND assurance_opinion IS NOT NULL) AS opinion_set,
       (SELECT count(*) FROM vendor_assurance_cuecs WHERE organization_id ${orgFilter} AND review_status='accepted') AS accepted_cuecs,
       (SELECT count(*) FROM vendor_assurance_cuec_control_mappings WHERE organization_id ${orgFilter} AND mapping_status='accepted' AND mapping_source <> 'auto') AS accepted_manual_mappings`, P);

// Any nonzero result must be a REAL requirement, never the synthetic umbrella.
const covered = await q(`${CHAIN}
SELECT DISTINCT reference_id, canonical_key, mapping_version, document_id::text
  FROM h7 ORDER BY reference_id`, P);
const synthetic = covered.filter((r) => String(r.reference_id).startsWith("industry-template:"));

console.log("S4PREDICATE " + JSON.stringify({
  org: ORG ?? "ALL",
  hops: hops[0],
  corpus: corpus[0],
  covered_requirements: covered,
  synthetic_umbrella_rows: synthetic.length,
  verdict: covered.length === 0 ? "DEAD" : synthetic.length > 0 ? "INVALID_SYNTHETIC" : "LIVE",
}));
await pool.end();
