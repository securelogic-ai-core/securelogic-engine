-- ROLLBACK for 20261069_control_canonical_identities (VA-S4 Step 1).
--
-- Roll this back FIRST of the three: it references canonical_controls with
-- ON DELETE RESTRICT.
--
-- Code rollback alone is sufficient — no live request path reads this table.
--
-- DATA LOSS: drops every tenant control -> canonical control link, including
-- human ATTESTATIONS (provenance='attestation'), which are governance acts and
-- are not reconstructible. 'template'-provenance rows ARE reconstructible by
-- re-running a template load. Snapshot first:
--   COPY (SELECT * FROM control_canonical_identities) TO '/tmp/cci.csv' CSV HEADER;
--
-- Idempotent.

DROP TABLE IF EXISTS control_canonical_identities;
