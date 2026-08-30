-- ROLLBACK for 20261067_canonical_controls (VA-S4 Step 1).
--
-- Code rollback alone is sufficient: nothing in a live request path reads these
-- tables — Step 1 is reference-content foundation only, S4 is not wired, and no
-- resolver, scorer or route consumes a canonical control. Run this only if the
-- schema itself must go.
--
-- ORDER MATTERS: 20261068 and 20261069 both reference canonical_controls with
-- ON DELETE RESTRICT, so roll those back FIRST (69, then 68, then this file).
--
-- DATA LOSS: drops the published SecureLogic canonical control corpus and every
-- alias that preserves an {industry}:control:* slug's historical meaning. The
-- corpus is version-controlled in src/api/lib/controls/canonicalControlCorpus.ts
-- and is republishable, but the PUBLICATION DECISIONS (who published, when) are
-- human governance acts and are not reconstructible. Snapshot first:
--   COPY (SELECT * FROM canonical_controls)        TO '/tmp/canonical_controls.csv' CSV HEADER;
--   COPY (SELECT * FROM canonical_control_aliases) TO '/tmp/canonical_control_aliases.csv' CSV HEADER;
--
-- Idempotent.

DROP TRIGGER IF EXISTS canonical_controls_publication_guard ON canonical_controls;
DROP FUNCTION IF EXISTS canonical_controls_guard_publication();

DROP TABLE IF EXISTS canonical_control_aliases;
DROP TABLE IF EXISTS canonical_controls;
