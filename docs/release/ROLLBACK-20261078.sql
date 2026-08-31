-- Rollback for 20261078. Restores `customer` classification to the single
-- organisation 20261078 reclassified, and nothing else. Safe on a database
-- where 20261078 never applied: it matches by identity, and that identity
-- exists only on staging.
UPDATE organizations
   SET tenant_class = 'customer'
 WHERE tenant_class = 'synthetic_fixture'
   AND id = 'a0755951-0809-4481-a733-38334b5df85f'::uuid;
