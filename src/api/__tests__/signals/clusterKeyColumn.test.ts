/**
 * clusterKeyColumn.test.ts — Priority 4 / Phase 4C / C2.
 *
 * Guards the additive cluster_key column + index migration, the normalizer
 * stamping (single source of truth), and the backfill. No live DB: the migration
 * is asserted by parsing its text; the backfill runs against an injected mock.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeSignal } from "../../lib/cyberSignalNormalizer.js";
import { clusterKey } from "../../lib/signals/clusterKey.js";
import {
  backfillClusterKeys,
  type Queryable
} from "../../lib/signals/clusterKeyBackfill.js";

const MIGRATION = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../db/migrations/20260709_cyber_signals_cluster_key.sql"
  ),
  "utf8"
);
const ddl = MIGRATION.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("cluster_key migration — shape + R-1 invariant (C2)", () => {
  it("adds a nullable cluster_key TEXT column, idempotently", () => {
    expect(ddl).toMatch(/ALTER TABLE cyber_signals\s+ADD COLUMN IF NOT EXISTS cluster_key TEXT/i);
    expect(ddl).not.toMatch(/cluster_key TEXT NOT NULL/i);
  });

  it("creates a NON-UNIQUE partial index (never unique)", () => {
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS idx_cyber_signals_cluster_key/i);
    expect(ddl).toMatch(/WHERE cluster_key IS NOT NULL/i);
    expect(ddl).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it("never touches dedup_hash, the dedup unique indexes, or ON CONFLICT (R-1)", () => {
    expect(ddl).not.toMatch(/dedup_hash/i);
    expect(ddl).not.toMatch(/idx_cyber_signals_dedup/i);
    expect(ddl).not.toMatch(/idx_cyber_signals_global_dedup/i);
    expect(ddl).not.toMatch(/ON CONFLICT/i);
    expect(ddl).not.toMatch(/DROP .*UNIQUE|ALTER .*dedup/i);
  });

  it("documents a reversal (DROP INDEX + DROP COLUMN)", () => {
    expect(MIGRATION).toMatch(/DROP INDEX IF EXISTS idx_cyber_signals_cluster_key/i);
    expect(MIGRATION).toMatch(/DROP COLUMN IF EXISTS cluster_key/i);
  });
});

describe("normalizeSignal — stamps cluster_key (single source of truth) (C2)", () => {
  const at = new Date("2026-06-28T12:00:00.000Z");
  const base = {
    source: "nvd",
    signal_type: "cve",
    severity: "High",
    raw_payload: {},
    normalized_summary: "x",
    affected_vendor: null as string | null,
    affected_cve: null as string | null,
    external_id: null as string | null
  };

  it("equals clusterKey() for the CVE-primary case", () => {
    const out = normalizeSignal({ ...base, affected_cve: "CVE-2026-1234" }, at);
    expect(out.cluster_key).toBe("cve:CVE-2026-1234");
    expect(out.cluster_key).toBe(
      clusterKey({ affected_cve: "CVE-2026-1234", affected_vendor: null, signal_type: "cve", ingestion_timestamp: at })
    );
  });

  it("equals clusterKey() for the CVE-less fingerprint case (uses injected `at`)", () => {
    const out = normalizeSignal({ ...base, affected_vendor: "Acme", signal_type: "patch_advisory" }, at);
    expect(out.cluster_key).toBe("fp:acme|patch_advisory|2026-06-28");
  });

  it("is null for the degenerate case (no CVE, no vendor) and leaves dedup_hash set", () => {
    const out = normalizeSignal({ ...base }, at);
    expect(out.cluster_key).toBeNull();
    expect(out.dedup_hash).toBeTruthy(); // dedup unaffected by the addition
  });
});

/** Mock client: serves NULL-cluster rows once (cursor-paged), records UPDATEs. */
function mockDb(rows: Array<Record<string, unknown>>) {
  const updates: Array<{ params: unknown[] }> = [];
  const sqls: string[] = [];
  const db: Queryable = {
    async query<T>(text: string, params: unknown[] = []) {
      sqls.push(text);
      if (/UPDATE\s+cyber_signals/i.test(text)) {
        updates.push({ params });
        return { rows: [] as T[] };
      }
      // SELECT … WHERE id > $1 ORDER BY id LIMIT $2 — return rows past the cursor.
      const cursor = params[0] as string;
      const page = rows.filter((r) => (r.id as string) > cursor).slice(0, params[1] as number);
      return { rows: page as T[] };
    }
  };
  return { db, updates, sqls };
}

describe("backfillClusterKeys — populate (C2)", () => {
  it("stamps non-null keys, skips degenerate, reports counts, and is global-only", async () => {
    const { db, updates, sqls } = mockDb([
      { id: "a", affected_cve: "CVE-2026-1234", affected_vendor: null, signal_type: "cve", ingestion_timestamp: "2026-06-28T00:00:00Z" },
      { id: "b", affected_cve: null, affected_vendor: "Acme", signal_type: "patch_advisory", ingestion_timestamp: "2026-06-28T00:00:00Z" },
      { id: "c", affected_cve: null, affected_vendor: null, signal_type: "cve", ingestion_timestamp: "2026-06-28T00:00:00Z" } // degenerate
    ]);
    const res = await backfillClusterKeys(db, 1000);
    expect(res).toEqual({ scanned: 3, stamped: 2 }); // 'c' left NULL
    expect(updates.map((u) => u.params)).toEqual([
      ["cve:CVE-2026-1234", "a"],
      ["fp:acme|patch_advisory|2026-06-28", "b"]
    ]);
    for (const sql of sqls) expect(sql).not.toMatch(/organization_id/i);
    expect(sqls.some((s) => /WHERE cluster_key IS NULL/i.test(s))).toBe(true);
  });

  it("terminates with no rows (idempotent re-run)", async () => {
    const { db } = mockDb([]);
    expect(await backfillClusterKeys(db)).toEqual({ scanned: 0, stamped: 0 });
  });
});
