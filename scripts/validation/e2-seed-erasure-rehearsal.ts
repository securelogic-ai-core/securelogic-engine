/**
 * e2-seed-erasure-rehearsal.ts — E-2 Increment 3 end-to-end rehearsal.
 *
 * Drives the COMPLETE lifecycle against disposable `[SEED]` tenants and prints
 * a transcript, so the evidence is a narrative an operator can read rather than
 * a test summary. Every tenant it touches is created by this script and named
 * `[SEED] …`; it never selects, modifies or erases anything else.
 *
 * SAFETY RAILS, checked before anything runs:
 *   * refuses any TEST_DATABASE_URL that looks like production
 *   * erases ONLY organizations it created in this run, by id
 *   * asserts erasure_agent is still NOLOGIN at the end
 *
 * Run: TEST_DATABASE_URL=... npx tsx scripts/validation/e2-seed-erasure-rehearsal.ts
 */
import { Pool, type PoolClient } from "pg";
import {
  requestErasure, approveErasure, dryRunErasure, executeErasure,
  claimForExecution, recordExecutionFailure,
} from "../../src/api/lib/governance/erasure/erasureExecutor.js";
import { inventoryOrganization } from "../../src/api/lib/governance/erasure/erasureInventory.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) { console.error("TEST_DATABASE_URL required"); process.exit(1); }
if (/prod/i.test(url)) { console.error("Refusing: looks like production."); process.exit(1); }

const pool = new Pool({ connectionString: url, ssl: false });
const created: string[] = [];
let failures = 0;
const step = (n: string) => console.log(`\n── ${n} ${"─".repeat(Math.max(0, 66 - n.length))}`);
const ok = (l: string, d = "") => console.log(`   PASS  ${l}${d ? " — " + d : ""}`);
const bad = (l: string, d = "") => { failures++; console.log(`   FAIL  ${l}${d ? " — " + d : ""}`); };
const check = (c: boolean, l: string, d = "") => (c ? ok(l, d) : bad(l, d));

async function seedTenant(label: string): Promise<{ org: string; requester: string; approver: string }> {
  const org = (await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [`[SEED] ${label}`, `seed-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Math.floor(Math.random() * 1e9)}`]
  )).rows[0]!.id;
  created.push(org);

  const mkUser = async (tag: string) => (await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, password_hash, role, status)
     VALUES ($1,$2,$3,'x','admin','active') RETURNING id`,
    [org, `${tag}-${Math.floor(Math.random() * 1e9)}@seed.invalid`, `[SEED] ${tag}`]
  )).rows[0]!.id;

  const requester = await mkUser("requester");
  const approver = await mkUser("approver");

  // A little of everything a real tenant accumulates, including WORM rows and
  // a table that BLOCKS the delete until cleared.
  await pool.query(`INSERT INTO security_audit_log (organization_id, actor_user_id, event_type, resource_type)
                    VALUES ($1,$2,'seed.activity','probe')`, [org, requester]);
  await pool.query(`INSERT INTO ask_conversations (organization_id, user_id, mode) VALUES ($1,$2,'text')`,
                   [org, requester]);
  await pool.query(`INSERT INTO user_alert_preferences (organization_id, user_id) VALUES ($1,$2)`,
                   [org, requester]).catch(() => {});
  return { org, requester, approver };
}

async function asOwner<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

async function asAgent<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET SESSION AUTHORIZATION erasure_agent");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { await c.query("RESET SESSION AUTHORIZATION").catch(() => {}); c.release(); }
}

async function fullApproval(t: { org: string; requester: string; approver: string }, destructive = true) {
  return asOwner(async (c) => {
    const req = await requestErasure(c, {
      organizationId: t.org, actorUserId: t.requester, actorRole: "admin",
      reason: "[SEED] rehearsal", legalBasis: "operator_decommission" });
    if (req.outcome !== "requested") throw new Error(`request denied: ${req.reason}`);
    const app = await approveErasure(c, {
      certificateId: req.certificateId, actorUserId: t.approver, actorRole: "admin", destructive });
    if (app.outcome !== "approved") throw new Error(`approve denied: ${app.reason}`);
    return req.certificateId;
  });
}

(async () => {
  console.log("E-2 Increment 3 — [SEED] end-to-end erasure rehearsal\n");
  console.log(`database: ${url.replace(/:[^:@]*@/, ":***@")}`);

  /* ══════════════ HAPPY PATH ══════════════ */
  step("1. REQUEST + INVENTORY");
  const t = await seedTenant("Happy Path");
  const inv0 = await asOwner((c) => inventoryOrganization(c, t.org));
  check(inv0.totalRows > 0, "tenant has data", `${inv0.totalRows} rows across ${Object.keys(inv0.inventory).length} tables`);
  check(inv0.tablesScanned > 100, "inventory scanned the whole schema", `${inv0.tablesScanned} org-scoped tables`);
  check(inv0.blocking.length > 0, "blocking FK edges discovered", `${inv0.blocking.length} org-scoped`);

  step("2. DRY RUN (non-destructive default)");
  const certId = await fullApproval(t);
  const dry = await asOwner((c) => dryRunErasure(c, { certificateId: certId, actorUserId: t.requester }));
  if ("wouldDelete" in dry) {
    check(dry.refusalIfExecutedNow === null, "dry run reports it would proceed");
    check(dry.scopeMatchesApproval === true, "observed scope matches the approval");
    check(dry.activeLegalHolds === 0, "no legal hold");
    ok("would delete", `${dry.totalRows} rows`);
  } else bad("dry run denied", dry.reason);
  check((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [t.org])).rowCount === 1,
        "tenant still present after the dry run");

  step("3. AUTHORIZED EXECUTION");
  const res = await asAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
  check(res.outcome === "erased", "erasure executed", res.outcome === "erased" ? `${res.totalRows} rows` : "");

  step("4. COMPLETION VERIFICATION");
  check((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [t.org])).rowCount === 0, "organization is gone");
  check((await pool.query(`SELECT 1 FROM users WHERE organization_id=$1`, [t.org])).rowCount === 0, "users are gone");
  check((await pool.query(`SELECT 1 FROM ask_conversations WHERE organization_id=$1`, [t.org])).rowCount === 0,
        "tenant content is gone");

  step("5. CERTIFICATE + AUDIT VERIFICATION");
  const cert = (await pool.query<{ status: string; scope_digest: Record<string, number>; retain_until: Date;
                                   organization_name_digest: string }>(
    `SELECT status, scope_digest, retain_until, organization_name_digest
       FROM erasure_certificates WHERE id=$1`, [certId])).rows[0]!;
  check(cert.status === "completed", "certificate completed");
  check(!!cert.scope_digest && cert.scope_digest["organizations"] === 1, "scope digest records what was destroyed");
  check(Object.values(cert.scope_digest).every((v) => typeof v === "number"), "digest holds COUNTS only");
  check(!JSON.stringify(cert.scope_digest).includes("[SEED]"), "digest contains no tenant content");
  check(cert.organization_name_digest.length === 64 && !cert.organization_name_digest.includes("SEED"),
        "organization name retained only as a digest");
  const years = (new Date(cert.retain_until).getTime() - Date.now()) / (365.25 * 86_400_000);
  check(years > 6.9 && years < 7.1, "retained seven years", `${years.toFixed(2)}y`);

  const events = (await pool.query<{ event_type: string }>(
    `SELECT event_type FROM security_audit_log WHERE resource_id=$1 ORDER BY created_at`, [certId])).rows
    .map((r) => r.event_type);
  for (const e of ["governance.erasure_requested", "governance.erasure_approved",
                   "governance.erasure_dry_run", "governance.erasure_started",
                   "governance.erasure_completed"]) {
    check(events.includes(e), `audited: ${e.replace("governance.erasure_", "")}`);
  }
  const completed = (await pool.query<{ organization_id: string | null; payload: Record<string, unknown> }>(
    `SELECT organization_id, payload FROM security_audit_log
      WHERE resource_id=$1 AND event_type='governance.erasure_completed'`, [certId])).rows[0]!;
  check(completed.organization_id === null, "completion event survives with a NULL organization");
  check(completed.payload["erasedOrganizationId"] === t.org, "the erased id is carried in the payload");

  /* ══════════════ NEGATIVE PATHS ══════════════ */
  step("6. NEGATIVE — self-approval");
  const n1 = await seedTenant("Self Approval");
  const selfRes = await asOwner(async (c) => {
    const r = await requestErasure(c, { organizationId: n1.org, actorUserId: n1.requester,
      actorRole: "admin", reason: "[SEED]", legalBasis: "operator_decommission" });
    if (r.outcome !== "requested") throw new Error("request denied");
    return approveErasure(c, { certificateId: r.certificateId, actorUserId: n1.requester,
      actorRole: "admin", destructive: true });
  });
  check(selfRes.outcome === "denied" && selfRes.reason === "self_approval", "self-approval refused");

  step("7. NEGATIVE — expired approval");
  const n2 = await seedTenant("Expired");
  const c2 = await fullApproval(n2);
  await pool.query(`UPDATE erasure_certificates SET approval_expires_at=now()-interval '1 minute' WHERE id=$1`, [c2]);
  const r2 = await asAgent((c) => executeErasure(c, { certificateId: c2, actorUserId: null }));
  check(r2.outcome === "refused" && r2.reason === "approval_expired", "expired approval refused");

  step("8. NEGATIVE — deprovisioned approver (ruling 2026-08-16)");
  const n3 = await seedTenant("Deprovisioned");
  const c3 = await fullApproval(n3);
  await pool.query(`UPDATE users SET status='inactive' WHERE id=$1`, [n3.approver]);
  const r3 = await asAgent((c) => executeErasure(c, { certificateId: c3, actorUserId: null }));
  check(r3.outcome === "refused" && r3.reason === "approver_unauthorized", "deprovisioned approver voids the approval");
  await pool.query(`UPDATE users SET status='active' WHERE id=$1`, [n3.approver]);
  const r3b = await asAgent((c) => executeErasure(c, { certificateId: c3, actorUserId: null }));
  check(r3b.outcome === "erased", "restoring authorization allows it to proceed");

  step("9. NEGATIVE — legal hold added AFTER approval (TOCTOU)");
  const n4 = await seedTenant("Hold After Approval");
  const c4 = await fullApproval(n4);
  await pool.query(`INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
                    VALUES ($1,'organization','[SEED] matter opened after approval',$2)`, [n4.org, n4.requester]);
  const r4 = await asAgent((c) => executeErasure(c, { certificateId: c4, actorUserId: null }));
  check(r4.outcome === "refused" && r4.reason === "legal_hold_active", "hold placed after approval stops execution");
  check((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [n4.org])).rowCount === 1, "tenant survived");

  step("10. NEGATIVE — inventory changed after approval");
  const n5 = await seedTenant("Scope Changed");
  const c5 = await fullApproval(n5);
  await pool.query(`INSERT INTO ask_conversations (organization_id, user_id, mode) VALUES ($1,$2,'text')`,
                   [n5.org, n5.requester]);
  const r5 = await asAgent((c) => executeErasure(c, { certificateId: c5, actorUserId: null }));
  check(r5.outcome === "refused" && r5.reason === "scope_changed", "changed scope voids the approval");

  step("11. NEGATIVE — duplicate execution");
  const n6 = await seedTenant("Duplicate");
  const c6 = await fullApproval(n6);
  const first = await asAgent((c) => executeErasure(c, { certificateId: c6, actorUserId: null }));
  const second = await asAgent((c) => executeErasure(c, { certificateId: c6, actorUserId: null }));
  check(first.outcome === "erased", "first execution erased");
  check(second.outcome === "refused", "replay refused", second.outcome === "refused" ? second.reason : "");

  step("12. NEGATIVE — interruption then retry");
  const n7 = await seedTenant("Interrupted");
  const c7 = await fullApproval(n7);
  await asOwner((c) => claimForExecution(c, c7));
  await asAgent(async () => { throw new Error("[SEED] simulated process death"); }).catch(() => {});
  const st = (await pool.query<{ status: string; attempt_count: number }>(
    `SELECT status, attempt_count FROM erasure_certificates WHERE id=$1`, [c7])).rows[0]!;
  check(st.status === "executing" && st.attempt_count === 1, "interrupted attempt is visible", `attempt ${st.attempt_count}`);
  check((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [n7.org])).rowCount === 1,
        "no data was lost by the interruption");
  await asOwner((c) => recordExecutionFailure(c, c7, new Error("[SEED] simulated process death")));
  const r7 = await asAgent((c) => executeErasure(c, { certificateId: c7, actorUserId: null }));
  check(r7.outcome === "erased", "retry re-passes every check and completes");

  step("13. NEGATIVE — cross-organization attempt");
  const a = await seedTenant("Cross A");
  const b = await seedTenant("Cross B");
  const certA = await fullApproval(a);
  const bBefore = await asOwner((c) => inventoryOrganization(c, b.org));
  const rX = await asAgent((c) => executeErasure(c, { certificateId: certA, actorUserId: null }));
  check(rX.outcome === "erased", "A erased under its own certificate");
  const bAfter = await asOwner((c) => inventoryOrganization(c, b.org));
  check(bAfter.totalRows === bBefore.totalRows, "B is untouched", `${bAfter.totalRows} rows`);
  check((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [b.org])).rowCount === 1, "B still exists");

  step("14. INERTNESS RECONFIRMED");
  const role = (await pool.query<{ rolcanlogin: boolean }>(
    `SELECT rolcanlogin FROM pg_roles WHERE rolname='erasure_agent'`)).rows[0]!;
  check(role.rolcanlogin === false, "erasure_agent is STILL NOLOGIN — no credential was issued");

  step("CLEANUP");
  let left = 0;
  for (const org of created) {
    const r = await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [org]);
    if (r.rowCount) left += 1;
  }
  ok("seed tenants created", String(created.length));
  ok("seed tenants remaining (refused paths)", String(left));

  console.log(`\n${failures === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED — ${failures} check(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})();
