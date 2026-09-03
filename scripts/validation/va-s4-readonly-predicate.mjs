/**
 * va-s4-readonly-predicate.mjs — the READ-ONLY S4 validation predicate.
 *
 * VALIDATION ONLY. This does NOT change production S4 behaviour: nothing here
 * is imported by `scopeResolver.ts` or any request path, and it performs no
 * writes. It answers one question — "which requirements WOULD be assurance
 * covered, and where does the chain break?" — so the wiring-plan §7 gate can be
 * re-run without touching the product.
 *
 * ── OWNER RULING 2026-08-30: this route is NOT canonical ───────────────────
 *
 * The CUEC spine is **not** the canonical S4 assurance-coverage route, and this
 * script must never be read as measuring one. A CUEC is a customer/user-entity
 * responsibility — a shared-responsibility condition the report places on the
 * READER. It is not evidence that the service organisation's control was tested
 * and operated effectively, and mapping one to a tenant control does not make
 * the vendor's control assured.
 *
 * The canonical model is instead:
 *
 *   governed evidence -> tested control / control assertion
 *     -> test result / exception state -> control <-> requirement mapping
 *     -> requirement assurance coverage
 *
 * with human gates and a preserved historical decision basis. That arm is
 * DESIGN-ONLY and is deliberately not built here.
 *
 * This script therefore survives as a **corpus diagnostic**, not a coverage
 * oracle: it measures the topology of the estate along the legacy route so the
 * shape of the gap stays visible. Its verdict is reported as
 * `NON_CANONICAL_ROUTE` whenever the chain resolves, precisely so a nonzero
 * count can never be mistaken for an S4 coverage claim.
 *
 * ── Three corrections against the earlier predicate ────────────────────────
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
 * 3. CUEC VOCABULARY. The clause this script previously carried at h6 —
 *    `vendor_assurance_cuecs.review_status = 'accepted'` — is **unsatisfiable
 *    by CHECK constraint**. Verified live 2026-08-30:
 *
 *      vendor_assurance_cuecs_review_status_check
 *        CHECK (review_status = ANY (ARRAY['pending','not_applicable',
 *                                          'satisfied','gap','reviewed_no_match']))
 *
 *    `'accepted'` is not in the vocabulary and no row can ever hold it, so the
 *    hop returned zero **independently of the corpus** and would have done so
 *    against a perfect one. Migration `20261036` replaced the CUEC model with a
 *    DETERMINATION model — a CUEC is determined `satisfied` / `gap` /
 *    `not_applicable`, never "accepted" — and this predicate had been written
 *    against the vocabulary that migration retired. It now requires a genuine
 *    human determination plus a named determiner.
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
 * ── The terminal break is DISJOINT TENANCY, at h5 ──────────────────────────
 *
 * Measured 2026-08-30, and it supersedes the earlier reading that the chain
 * died at the opinion hop. It does not: **no row has ever reached the opinion
 * hop.** The estate splits into two halves that never meet, and no organisation
 * holds both:
 *
 *   Enterprise Validation StageA  f70267ce   30 identities   0 VA documents
 *   Staging Inc                   fe2ede61    0 identities  53 VA documents
 *
 * StageA carries every `control_canonical_identities` row and NIST CSF 1.1, and
 * has no assurance evidence at all. Staging Inc carries every assurance
 * document, every CUEC and every mapping — against HAND-CREATED controls with no
 * canonical identity, under NIST SP 800-53 Rev 5, which the published corpus does
 * not cover.
 *
 * This was isolated by RELAXATION rather than inferred. h5 was re-measured with
 * each eligibility clause removed in turn:
 *
 *   mapping_status='accepted' AND mapping_source <> 'auto'   ->  0
 *   mapping_status='accepted'                                ->  0
 *   any mapping, any status, any source                      ->  0
 *
 * The bare structural join is empty. h5 is not failing an eligibility test;
 * there is nothing there to test, and a correctly org-scoped predicate MUST
 * return zero against this corpus. That is a corpus fact, not a defect.
 * `org_halves` below reports it on every run so the cause travels with the
 * numbers.
 *
 * ── h6 and h7 are dead too, for their own reasons ──────────────────────────
 *
 * Both sit downstream of an already-empty set, so neither can be blamed for the
 * result — but each would independently return zero even if h5 were populated:
 *
 *   h6  the retired-vocabulary defect, correction 3 above (now fixed).
 *
 *   h7  `vendor_assurance_documents.assurance_opinion` had **no writer anywhere
 *       in the codebase** when this script was written. VA-S4 Step 4 shipped the
 *       closed vocabulary, `opinionCoverageGate`, the advisory normalizer and the
 *       authority CHECK that makes an opinion without a named acceptor
 *       impossible — but no ACCEPTANCE SURFACE. Extraction DOES populate the
 *       source field (`auditor_opinion` non-null on 5/5 extractions at
 *       confidence 0.99, with page-1 spans), and the normalizer resolves the
 *       live string correctly to `qualified`; what was missing is the governed
 *       act. S4-P2 builds that surface. Until a document carries a
 *       human-accepted opinion, h7 stays zero, and this script reports it as a
 *       zero rather than working around it — the only alternative would be
 *       direct database manipulation, which would make the run a fabrication.
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
     -- A CUEC is DETERMINED, never "accepted". See correction 3 in the header:
     -- 'accepted' is not in the CHECK and no row can ever hold it. 'pending'
     -- means nobody has looked; 'reviewed_no_match' is the deprecated value
     -- that conflates "does not apply" with "we do not do it", and is excluded
     -- for exactly that reason.
     AND cu.review_status IN ('not_applicable', 'satisfied', 'gap')
     AND cu.review_status_updated_by_user_id IS NOT NULL
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

// The terminal break, reported alongside the numbers so the cause travels with
// them: which organisation holds which half of the chain. An empty h5 with the
// halves disjoint is a CORPUS fact; an empty h5 with a single org holding both
// would be something else entirely, and the reader must be able to tell.
const orgHalves = await q(`
SELECT o.name,
       (SELECT count(*) FROM control_canonical_identities i WHERE i.organization_id = o.id)::int AS identities,
       (SELECT count(*) FROM vendor_assurance_documents d  WHERE d.organization_id = o.id)::int AS va_documents,
       (SELECT count(*) FROM vendor_assurance_cuec_control_mappings m WHERE m.organization_id = o.id)::int AS mappings
  FROM organizations o
 WHERE o.id ${ORG ? "= $1" : "IS NOT NULL"}
   AND (EXISTS (SELECT 1 FROM control_canonical_identities i WHERE i.organization_id = o.id)
     OR EXISTS (SELECT 1 FROM vendor_assurance_documents d  WHERE d.organization_id = o.id))
 ORDER BY 2 DESC, 3 DESC`, P);
const holdsBothHalves = orgHalves.filter((r) => r.identities > 0 && r.va_documents > 0);

// Any nonzero result must be a REAL requirement, never the synthetic umbrella.
const covered = await q(`${CHAIN}
SELECT DISTINCT reference_id, canonical_key, mapping_version, document_id::text
  FROM h7 ORDER BY reference_id`, P);
const synthetic = covered.filter((r) => String(r.reference_id).startsWith("industry-template:"));

// VERDICT VOCABULARY. `NON_CANONICAL_ROUTE` exists because of the 2026-08-30
// owner ruling: a chain that RESOLVES along this route still proves nothing
// about assurance coverage, so "LIVE" would be an actively misleading label.
// There is deliberately no verdict value that asserts coverage.
const verdict =
  covered.length === 0
    ? "DEAD"
    : synthetic.length > 0
      ? "INVALID_SYNTHETIC"
      : "NON_CANONICAL_ROUTE";

console.log("S4PREDICATE " + JSON.stringify({
  org: ORG ?? "ALL",
  hops: hops[0],
  corpus: corpus[0],
  org_halves: orgHalves,
  orgs_holding_both_halves: holdsBothHalves.length,
  terminal_break:
    holdsBothHalves.length === 0
      ? "h5_disjoint_tenancy: no organisation holds both a canonical identity and an assurance document"
      : "h5_populated_check_eligibility_clauses",
  covered_requirements: covered,
  synthetic_umbrella_rows: synthetic.length,
  verdict,
  verdict_note:
    "NON_CANONICAL_ROUTE is not coverage. Owner ruling 2026-08-30: the CUEC " +
    "spine is not the canonical S4 assurance-coverage route. This script is a " +
    "corpus diagnostic only and no value it can emit authorises depth reduction.",
}));
await pool.end();
