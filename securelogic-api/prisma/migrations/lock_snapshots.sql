-- ===============================
-- Prevent UPDATE/DELETE of finalized snapshots
-- ===============================

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Snapshots are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if present
DROP TRIGGER IF EXISTS trg_prevent_snapshot_update ON "RunSnapshot";
DROP TRIGGER IF EXISTS trg_prevent_snapshot_delete ON "RunSnapshot";

-- Block updates
CREATE TRIGGER trg_prevent_snapshot_update
BEFORE UPDATE ON "RunSnapshot"
FOR EACH ROW
EXECUTE FUNCTION prevent_snapshot_mutation();

-- Block deletes
CREATE TRIGGER trg_prevent_snapshot_delete
BEFORE DELETE ON "RunSnapshot"
FOR EACH ROW
EXECUTE FUNCTION prevent_snapshot_mutation();
