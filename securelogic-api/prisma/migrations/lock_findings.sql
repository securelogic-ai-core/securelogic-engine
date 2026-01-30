-- Prevent inserting findings into finalized runs
CREATE OR REPLACE FUNCTION prevent_findings_on_finalized_run()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Run"
    WHERE id = NEW."runId"
      AND status = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'Cannot insert findings into finalized run %', NEW."runId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_findings_on_finalized_run ON "Finding";

CREATE TRIGGER trg_prevent_findings_on_finalized_run
BEFORE INSERT ON "Finding"
FOR EACH ROW
EXECUTE FUNCTION prevent_findings_on_finalized_run();
