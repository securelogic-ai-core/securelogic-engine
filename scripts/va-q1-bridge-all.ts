/**
 * va-q1-bridge-all.ts — VA-Q1 P3: bridge every activated requirement of every
 * org (or one org) into the question library. Idempotent; safe to re-run.
 *
 * Usage (DATABASE_URL in the environment, as on a Render job):
 *   tsx scripts/va-q1-bridge-all.ts                 # every org
 *   tsx scripts/va-q1-bridge-all.ts --org <uuid>    # one org
 *   tsx scripts/va-q1-bridge-all.ts --dry-run       # report only, no writes
 *
 * Refuses to run against production (current_database = 'securelogic'):
 * VA-Q1 is a develop/staging capability until the promotion that carries it,
 * and this script must never be the thing that quietly changes prod.
 *
 * Never stamps versions onto already-issued engagements — see bridgeAll.ts.
 */

import { pg, pgElevated, withTenant } from "../src/api/infra/postgres.js";
import { bridgeAllRequirements } from "../src/api/lib/questionnaire/bridgeAll.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const orgIdx = args.indexOf("--org");
  const onlyOrg = orgIdx >= 0 ? args[orgIdx + 1] : null;

  const db = await pgElevated.query<{ current_database: string }>("SELECT current_database()");
  if (db.rows[0]!.current_database === "securelogic") {
    console.error("refusing to run against production (current_database = securelogic)");
    process.exit(2);
  }

  const orgs = await pgElevated.query<{ id: string; name: string }>(
    `SELECT DISTINCT o.id, o.name FROM organizations o
       JOIN frameworks f ON f.organization_id = o.id
      WHERE ($1::uuid IS NULL OR o.id = $1::uuid)
      ORDER BY o.name`,
    [onlyOrg]
  );
  console.log(`${dryRun ? "[dry-run] " : ""}${orgs.rows.length} org(s) with activated frameworks`);

  let totalReq = 0, totalNew = 0;
  for (const org of orgs.rows) {
    // withTenant already owns the transaction (BEGIN … COMMIT, ROLLBACK on
    // throw). A dry run therefore throws a sentinel AFTER the work, carrying
    // the result out through the rollback path — nothing is persisted.
    class DryRun extends Error { constructor(public readonly result: Awaited<ReturnType<typeof bridgeAllRequirements>>) { super("dry-run"); } }
    let r: Awaited<ReturnType<typeof bridgeAllRequirements>>;
    try {
      r = await withTenant(org.id, async () => {
        const res = await bridgeAllRequirements(pg, org.id);
        if (dryRun) throw new DryRun(res);
        return res;
      });
    } catch (e) {
      if (e instanceof DryRun) r = e.result; else throw e;
    }
    totalReq += r.requirements; totalNew += r.created_or_reversioned;
    console.log(`  ${org.name} (${org.id.slice(0, 8)}): requirements=${r.requirements} bridged=${r.bridged} unchanged=${r.unchanged} created_or_reversioned=${r.created_or_reversioned}`);
  }
  console.log(`done: requirements=${totalReq} created_or_reversioned=${totalNew}${dryRun ? " (rolled back)" : ""}`);
  await pgElevated.end();
  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
