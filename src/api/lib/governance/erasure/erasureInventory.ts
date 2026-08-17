/**
 * erasureInventory.ts — what a tenant erasure would destroy, derived from the
 * live FK graph rather than a hand-written list.
 *
 * A hand-written list is wrong the day someone adds a table. This module asks
 * the database what is org-scoped and what blocks a delete, so an erasure
 * cannot silently miss a table that arrived after the code was written — and so
 * the approved scope is a measurement rather than an assertion.
 */

import type { PoolClient } from "pg";
import type { Inventory } from "./erasurePolicy.js";

/** A table that must be emptied BEFORE the organization row can be deleted. */
export interface BlockingEdge {
  child: string;
  parent: string;
  rule: string;
  orgScoped: boolean;
}

export interface OrganizationInventory {
  organizationId: string;
  /** Only tables that actually hold rows for this org. */
  inventory: Inventory;
  totalRows: number;
  /** Org-scoped tables whose FKs would otherwise block the delete. */
  blocking: BlockingEdge[];
  /** Tables scanned, whether or not they held rows. */
  tablesScanned: number;
}

/**
 * Count of org-scoped tables scanned. Via the SECURITY DEFINER helper so the
 * erasure role never needs catalogue-wide privileges of its own.
 */
export async function scannedTableCount(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT erasure_scanned_table_count()::text AS n`
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * FK edges that REFUSE a parent delete rather than following it. These are the
 * reason an erasure is not simply `DELETE FROM organizations`: PostgreSQL will
 * raise on the first one that still has rows.
 *
 * Discovered rather than listed — there are seventeen today, and the set moves
 * with the schema.
 */
export async function blockingEdges(client: PoolClient): Promise<BlockingEdge[]> {
  const { rows } = await client.query<{
    child: string; parent: string; rule: string; org_scoped: boolean;
  }>(
    `SELECT c.relname AS child, pc.relname AS parent, rc.delete_rule AS rule,
            EXISTS (
              SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema = 'public'
                 AND col.table_name = c.relname
                 AND col.column_name = 'organization_id'
            ) AS org_scoped
       FROM information_schema.referential_constraints rc
       JOIN pg_constraint con ON con.conname = rc.constraint_name
       JOIN pg_class c  ON c.oid  = con.conrelid
       JOIN pg_class pc ON pc.oid = con.confrelid
      WHERE rc.delete_rule IN ('RESTRICT','NO ACTION')
      ORDER BY c.relname, pc.relname`
  );
  return rows.map((r) => ({
    child: r.child, parent: r.parent, rule: r.rule, orgScoped: r.org_scoped,
  }));
}

/**
 * Count this organization's rows in every org-scoped table.
 *
 * Table names come from information_schema and are quoted, never interpolated
 * from user input; the org id is always a bound parameter. Tables with zero
 * rows are omitted, so the fingerprint reflects what exists rather than what
 * the schema happens to contain.
 */
export async function inventoryOrganization(
  client: PoolClient,
  organizationId: string
): Promise<OrganizationInventory> {
  // Counts come from the SECURITY DEFINER function, not from 115 direct
  // SELECTs. That is what lets the executor re-inventory at the moment of
  // destruction while holding no read privilege on any tenant table — the
  // property that keeps a stolen erasure credential from also being a data
  // exfiltration credential.
  const { rows } = await client.query<{ table_name: string; row_count: string }>(
    `SELECT table_name, row_count::text AS row_count FROM erasure_inventory($1) ORDER BY table_name`,
    [organizationId]
  );

  const inventory: Record<string, number> = {};
  let totalRows = 0;
  for (const r of rows) {
    const n = Number(r.row_count);
    inventory[r.table_name] = n;
    totalRows += n;
  }

  const edges = await blockingEdges(client);
  return {
    organizationId,
    inventory,
    totalRows,
    blocking: edges.filter((e) => e.orgScoped),
    tablesScanned: await scannedTableCount(client),
  };
}

/**
 * Empty the org-scoped tables whose FKs would block the delete.
 *
 * Delegates to the SECURITY DEFINER function `erasure_clear_blocking`, so the
 * erasure role needs no privilege on any of those thirteen tenant tables — see
 * 20261019. The discovery, ordering and retry all happen server-side, which
 * also means a schema change that adds a blocking edge is handled without a
 * code change here.
 *
 * It bypasses PRIVILEGES, not the WORM guard: SECURITY DEFINER changes
 * current_user, never session_user, so the guard still requires a valid
 * certificate, a matching org and the absence of a legal hold.
 */
export async function clearBlockingRows(
  client: PoolClient,
  organizationId: string,
  _blocking: BlockingEdge[]
): Promise<Record<string, number>> {
  const { rows } = await client.query<{ cleared: Record<string, number> }>(
    `SELECT erasure_clear_blocking($1) AS cleared`,
    [organizationId]
  );
  const cleared = rows[0]?.cleared ?? {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cleared)) out[k] = Number(v);
  return out;
}
