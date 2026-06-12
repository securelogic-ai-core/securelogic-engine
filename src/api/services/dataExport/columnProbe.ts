/**
 * columnProbe.ts — resolves a table's live column list from information_schema so
 * the query builders can project an explicit allowlist instead of `SELECT *` for
 * tables that carry `exportExcludedColumns` (credentials / capability tokens).
 *
 * WHY A PROBE (not a hand-coded allowlist). A static column list in source would
 * silently under-export as soon as a migration adds a column. Reading the live
 * schema keeps the export complete-by-default while the `exportExcludedColumns`
 * denylist keeps secrets out. This mirrors `dependencyAssessmentsProbe.ts`: the
 * probe is a separate module and its result is INJECTED into the (pure, sync)
 * builders — the builders never query the database themselves.
 *
 * The result is cached per table for the lifetime of the process; schema does not
 * change under a running process. `resetColumnCache()` exists for tests.
 */

import {
  TABLE_CLASSIFICATION,
} from "../../lib/dataClassification.js";
import type { QueryRunner, TableColumns } from "./types.js";

const cache = new Map<string, string[]>();

/**
 * All column names for `table` in the `public` schema, in `ordinal_position`
 * order. Parameterized — the table name is bound, never interpolated.
 */
export async function getTableColumns(run: QueryRunner, table: string): Promise<string[]> {
  const cached = cache.get(table);
  if (cached) return cached;

  const { rows } = await run(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  const columns = rows.map((r) => String(r.column_name));
  cache.set(table, columns);
  return columns;
}

/**
 * The tables that REQUIRE an explicit projection because they set
 * `exportExcludedColumns`. The executor (PR #2b) probes exactly these and passes
 * the resulting map to the builders; every other table is `SELECT *`.
 */
export function tablesRequiringProjection(): string[] {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([, c]) => (c.exportExcludedColumns?.length ?? 0) > 0)
    .map(([table]) => table);
}

/**
 * Probe every projection-requiring table and return a `TableColumns` map ready to
 * hand to the builders. Convenience for the PR #2b executor.
 */
export async function buildTableColumnsMap(run: QueryRunner): Promise<TableColumns> {
  const map: Record<string, readonly string[]> = {};
  for (const table of tablesRequiringProjection()) {
    map[table] = await getTableColumns(run, table);
  }
  return map;
}

/** Test-only: clear the per-process column cache. */
export function resetColumnCache(): void {
  cache.clear();
}
