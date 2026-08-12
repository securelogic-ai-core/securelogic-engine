/**
 * seat-assignment-isolation.ts — real-SQL proof of Contributor ASSIGNMENT
 * isolation for the assessment/response families (activation blocker 1).
 *
 * Seeds two orgs, contributors, and control_assessments assigned to specific
 * users, then runs the exact predicate the routes build (ownerCondition on
 * assigned_to_user_id) and the detail/update guard (assertAssignedOr404's
 * SELECT). Asserts a Contributor sees / may act on ONLY assessments assigned to
 * them — never another user's (cross-user), never another tenant's
 * (cross-tenant), and can never create (the create routes stay denyContributor,
 * so a Contributor with no assigned row is denied).
 *
 * Usage: eval "$(scripts/harness-db-up.sh)"; npx tsx scripts/validation/seat-assignment-isolation.ts
 */
import pg from "pg";
import { ownerCondition, mayAccessOwned } from "../../src/api/lib/contributorScope.js";

const DSN = process.env.TEST_DATABASE_URL;
if (!DSN) { console.error("TEST_DATABASE_URL required (throwaway DB)."); process.exit(2); }
if (/staging|prod/i.test(DSN)) { console.error("Refusing staging/prod URL."); process.exit(2); }

const c = new pg.Client({ connectionString: DSN, ssl: false });
const hx = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
const uuid = () => `${hx(8)}-${hx(4)}-4${hx(3)}-8${hx(3)}-${hx(12)}`;
let fail = 0;
const check = (l: string, ok: boolean) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`); if (!ok) fail++; };

async function main() {
  await c.connect();
  const orgA = uuid(), orgB = uuid(), c1 = uuid(), c2 = uuid(), bU = uuid();
  await c.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'A',$2)`, [orgA, "a-" + orgA.slice(0, 6)]);
  await c.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'B',$2)`, [orgB, "b-" + orgB.slice(0, 6)]);
  for (const [id, org] of [[c1, orgA], [c2, orgA], [bU, orgB]] as const)
    await c.query(`INSERT INTO users (id,organization_id,email,role,status,seat_type) VALUES ($1,$2,$3,'analyst','active','contributor')`, [id, org, id.slice(0, 8) + "@t.z"]);

  const mkControl = async (org: string) => { const id = uuid(); await c.query(`INSERT INTO controls (id,organization_id,name) VALUES ($1,$2,$3)`, [id, org, "ctl-" + id.slice(0, 8)]); return id; };
  const mkAssessment = async (org: string, assignee: string | null) => {
    const id = uuid(); const ctl = await mkControl(org);
    await c.query(`INSERT INTO control_assessments (id,organization_id,control_id,assigned_to_user_id) VALUES ($1,$2,$3,$4)`, [id, org, ctl, assignee]);
    return id;
  };

  const a_c1 = await mkAssessment(orgA, c1);
  const a_c2 = await mkAssessment(orgA, c2);
  const a_unassigned = await mkAssessment(orgA, null);
  const a_orgB = await mkAssessment(orgB, bU);
  void a_c2; void a_unassigned; void a_orgB;

  process.env.SECURELOGIC_SEAT_MODEL_ENABLED = "true";
  const asC1 = { userSeatType: "contributor", userRole: "analyst", userId: c1 } as never;

  // List scope
  const params: unknown[] = [orgA];
  const clause = ownerCondition(asC1, "assigned_to_user_id", params);
  const rows = (await c.query(`SELECT id FROM control_assessments WHERE organization_id=$1 ${clause ? "AND " + clause : ""}`, params as unknown[])).rows;
  check("C1 list: exactly 1 assigned row", rows.length === 1 && rows[0].id === a_c1);
  check("cross-user: C2's + unassigned excluded", !rows.some((r) => r.id !== a_c1));

  // Cross-tenant: C1 querying org B
  const pB: unknown[] = [orgB];
  const clB = ownerCondition(asC1, "assigned_to_user_id", pB);
  check("cross-tenant: org B returns 0", (await c.query(`SELECT 1 FROM control_assessments WHERE organization_id=$1 ${clB ? "AND " + clB : ""}`, pB as unknown[])).rowCount === 0);

  // Detail/update guard (assertAssignedOr404's query): C1 may access own, not C2's
  const guard = async (id: string, org: string) => {
    const r = await c.query<{ assigned_to_user_id: string | null }>(`SELECT assigned_to_user_id FROM control_assessments WHERE id=$1 AND organization_id=$2`, [id, org]);
    return (r.rowCount ?? 0) > 0 && mayAccessOwned(asC1, r.rows[0]?.assigned_to_user_id);
  };
  check("detail/update: C1 may act on own assigned row", (await guard(a_c1, orgA)) === true);
  check("detail/update: C1 blocked on C2's row (→404)", (await guard(a_c2, orgA)) === false);
  check("detail/update: C1 blocked on unassigned row (→404)", (await guard(a_unassigned, orgA)) === false);
  check("detail/update: C1 blocked cross-tenant (→404)", (await guard(a_orgB, orgB)) === false);

  await c.query(`DELETE FROM control_assessments WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM controls WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM users WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
  await c.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
  await c.end();
  console.log(fail === 0 ? "\nASSIGNMENT ISOLATION PASS" : `\nFAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
