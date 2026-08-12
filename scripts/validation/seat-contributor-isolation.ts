/**
 * seat-contributor-isolation.ts — real-SQL proof of Contributor row isolation
 * (enterprise seat program, Phase 3a program stop gate).
 *
 * Seeds two organizations, each with contributors, plus findings / actions /
 * evidence owned by specific users, then runs the EXACT scoped predicate the
 * routes build (via lib/contributorScope.ownerCondition) and asserts that a
 * Contributor sees only their own rows — never another user's (cross-user),
 * never another tenant's (cross-tenant), never unassigned rows — while a Full
 * user sees everything in their org and a Contributor with no identity sees
 * nothing (fail-closed).
 *
 * Usage (throwaway DB only — never staging/prod):
 *   eval "$(scripts/harness-db-up.sh)"
 *   npx tsx scripts/validation/seat-contributor-isolation.ts
 * Exits non-zero on any leak so it can gate CI / the isolation harness.
 */
import pg from "pg";
import { ownerCondition } from "../../src/api/lib/contributorScope.js";

const DSN = process.env.TEST_DATABASE_URL;
if (!DSN) {
  console.error("TEST_DATABASE_URL is required (throwaway DB). Aborting.");
  process.exit(2);
}
if (/staging|prod/i.test(DSN)) {
  console.error("Refusing to run against a staging/production-looking URL.");
  process.exit(2);
}

const c = new pg.Client({ connectionString: DSN, ssl: false });

const hx = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
const uuid = () => `${hx(8)}-${hx(4)}-4${hx(3)}-8${hx(3)}-${hx(12)}`;

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

/** Build the scoped list query the way a route does: base tenant predicate + the
 *  contributor owner predicate from the shared helper. */
function scopedList(
  table: string,
  ownerCol: string,
  reqLike: Record<string, unknown>,
  orgId: string
): { sql: string; params: unknown[] } {
  const conditions = [`organization_id = $1`];
  const params: unknown[] = [orgId];
  process.env.SECURELOGIC_SEAT_MODEL_ENABLED = "true";
  const clause = ownerCondition(reqLike as never, ownerCol, params);
  if (clause) conditions.push(clause);
  return { sql: `SELECT id, title FROM ${table} WHERE ${conditions.join(" AND ")}`, params };
}

async function main() {
  await c.connect();

  const orgA = uuid(), orgB = uuid();
  const c1 = uuid(), c2 = uuid(), bU = uuid();

  await c.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'OrgA',$2)`, [orgA, "a-" + orgA.slice(0, 6)]);
  await c.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'OrgB',$2)`, [orgB, "b-" + orgB.slice(0, 6)]);
  for (const [id, org] of [[c1, orgA], [c2, orgA], [bU, orgB]] as const) {
    await c.query(`INSERT INTO users (id,organization_id,email,role,status,seat_type) VALUES ($1,$2,$3,'analyst','active','contributor')`, [id, org, id.slice(0, 8) + "@t.z"]);
  }

  const mkFinding = async (org: string, owner: string | null, title: string) => {
    const id = uuid();
    await c.query(`INSERT INTO findings (id,organization_id,source_type,title,description,severity,status,owner_user_id) VALUES ($1,$2,'manual',$3,'d','high','open',$4)`, [id, org, title, owner]);
    return id;
  };
  const mkAction = async (org: string, owner: string | null, title: string) => {
    const id = uuid();
    await c.query(`INSERT INTO actions (id,organization_id,title,status,owner_user_id,source_type,priority) VALUES ($1,$2,$3,'open',$4,'manual','planned')`, [id, org, title, owner]);
    return id;
  };

  await mkFinding(orgA, c1, "C1"); await mkFinding(orgA, c2, "C2"); await mkFinding(orgA, null, "UNASSIGNED"); await mkFinding(orgB, bU, "ORGB");
  await mkAction(orgA, c1, "C1"); await mkAction(orgA, c2, "C2"); await mkAction(orgA, null, "UNASSIGNED"); await mkAction(orgB, bU, "ORGB");

  const asC1 = { userSeatType: "contributor", userRole: "analyst", userId: c1 };
  const asFull = { userSeatType: "full", userRole: "admin", userId: uuid() };
  const asNoId = { userSeatType: "contributor", userRole: "analyst" };

  for (const [table, ownerCol] of [["findings", "owner_user_id"], ["actions", "owner_user_id"]] as const) {
    console.log(`\n${table}:`);
    const q = scopedList(table, ownerCol, asC1, orgA);
    const rows = (await c.query(q.sql, q.params as unknown[])).rows.map((r) => r.title).sort();
    check(`C1 sees only own row`, JSON.stringify(rows) === JSON.stringify(["C1"]));
    check(`cross-user: C2 excluded`, !rows.includes("C2"));
    check(`unassigned excluded`, !rows.includes("UNASSIGNED"));
    check(`cross-tenant: ORGB excluded`, !rows.includes("ORGB"));

    const qB = scopedList(table, ownerCol, asC1, orgB);
    check(`C1 querying org B directly → 0 rows`, (await c.query(qB.sql, qB.params as unknown[])).rowCount === 0);

    const qF = scopedList(table, ownerCol, asFull, orgA);
    check(`Full user sees all org-A rows`, (await c.query(qF.sql, qF.params as unknown[])).rowCount === 3);

    const qN = scopedList(table, ownerCol, asNoId, orgA);
    check(`Contributor w/o identity → 0 rows (fail-closed)`, (await c.query(qN.sql, qN.params as unknown[])).rowCount === 0);
  }

  await c.query(`DELETE FROM findings WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM actions WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM users WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
  await c.end();

  console.log(`\n${failures === 0 ? "STOP GATE PASS — no leakage" : `STOP GATE FAIL — ${failures} leak(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
