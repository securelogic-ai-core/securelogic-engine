-- Migration: applicability_assessments.asset_id — drop FK (WORM-safe pointer)
-- Package: Enterprise Risk Graph convergence — Phase C2
-- Docs: docs/architecture/proposals/CONVERGENCE-ROADMAP.md (C2)
--
-- THE CONFLICT this fixes: 20260804 added
--   applicability_assessments.asset_id UUID REFERENCES assets(id) ON DELETE SET NULL
-- but applicability_assessments is WORM (20260725 installs a blanket
-- BEFORE UPDATE OR DELETE row trigger that RAISES for every role). Deleting a
-- referenced asset would fire the FK's ON DELETE SET NULL, i.e. an UPDATE of the
-- assessment row, which the WORM trigger BLOCKS — so the asset delete would FAIL.
-- Unexercised today (the WORM tables are empty) but it would surface the moment an
-- EAR asset-target assessment exists and its asset is later deleted/retired.
--
-- THE FIX (preserves WORM + immutable evidence): a WORM record is an immutable
-- historical statement — "this decision was about asset X at decision time." A
-- later asset deletion must NOT mutate it (that is the whole point of WORM). So
-- asset_id becomes a RESOLVABLE, NO-FK historical pointer — exactly the codebase's
-- existing convention for immutable/reproducible pointers:
--   * applicability_affected_entities.node_id (no FK, polymorphic)
--   * applicability_evidence.ref_id          (no FK, by-query)
--   * assets.backing_id                      (no FK, polymorphic)
-- The column, its values, and all provenance are UNCHANGED — we only remove the
-- delete-cascade behavior. After this: deleting an asset SUCCEEDS, the immutable
-- assessment is byte-unchanged, and asset_id resolves-if-exists at read time.
--
-- The MUTABLE signal_match_suggestions.asset_id KEEPS its ON DELETE SET NULL (no
-- WORM there; already covered by phase2AssetTargets.test.ts) — untouched here.
--
-- ADDITIVE / DARK / REVERSIBLE: no data touched, no provenance rewritten, no row
-- mutation (pure DDL — the WORM trigger is row-DML-level, not DDL, so ALTER is
-- permitted). Name-agnostic + idempotent: looks up whatever FK sits on asset_id.
-- Rollback: re-add `REFERENCES assets(id) ON DELETE SET NULL` (but do not — it
-- reintroduces the conflict).

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname
    INTO fk_name
    FROM pg_constraint c
   WHERE c.conrelid = 'applicability_assessments'::regclass
     AND c.contype = 'f'
     AND c.conkey = ARRAY[(
       SELECT a.attnum
         FROM pg_attribute a
        WHERE a.attrelid = 'applicability_assessments'::regclass
          AND a.attname = 'asset_id'
     )];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE applicability_assessments DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;
