-- Fix SOC 2 framework name/version mismatch.
-- frameworkTemplates.ts stored name='SOC 2', version='Type II' but the
-- canonical display values (and page.tsx matching) expect
-- name='SOC 2 Type II', version='2017'.
-- This updates all existing org framework rows that used the old values.
UPDATE frameworks
SET name = 'SOC 2 Type II', version = '2017', updated_at = NOW()
WHERE name = 'SOC 2' AND version = 'Type II';
