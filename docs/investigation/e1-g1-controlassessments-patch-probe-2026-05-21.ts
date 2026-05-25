/**
 * e1-g1-controlassessments-patch-probe-2026-05-21.ts
 *
 * E1-G1 triage: disambiguate the cross-org PATCH 400 on control-assessments.
 * Drives the real app over the throwaway harness DB and runs the 2x2 probe
 * matrix (plus valid-body confirmation). Read-only investigation — changes
 * nothing in the codebase.
 *
 * Run:
 *   eval "$(scripts/harness-db-up.sh)"
 *   npx tsx docs/investigation/e1-g1-controlassessments-patch-probe-2026-05-21.ts
 */
import request from "supertest";

async function main(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set");

  // postgres.ts reads DATABASE_URL at import; set it before importing the app.
  process.env.DATABASE_URL = testUrl;
  process.env.DATABASE_SSL_DISABLED = "true";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  const { bootstrapTestDb } = await import("../../test/isolation/testDb.js");
  const seed = await bootstrapTestDb();

  const { createApp } = await import("../../src/api/app.js");
  const app = createApp({ isDev: false, publicApiDisabled: false });

  const show = (label: string, res: { status: number; body: unknown }): void => {
    console.log(`\n[${label}]\n  status: ${res.status}\n  body:   ${JSON.stringify(res.body)}`);
  };

  // Seed a control + control-assessment owned by org A.
  const ctlRes = await request(app)
    .post("/api/controls")
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ name: `Probe Control ${Date.now()}` });
  const controlId = (ctlRes.body as any)?.control?.id ?? (ctlRes.body as any)?.id;

  const caRes = await request(app)
    .post("/api/control-assessments")
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ control_id: controlId, status: "not_started" });
  const caId = (caRes.body as any)?.assessment?.id ?? (caRes.body as any)?.id;

  console.log(
    `seeded: orgA=${seed.orgA.id} orgB=${seed.orgB.id}\n` +
      `        controlId=${controlId} controlAssessmentId=${caId}`,
  );

  const NOTES = { notes: "harness cross-org probe" };
  const VALID = { status: "in_progress" };
  const NONEXISTENT = "00000000-0000-4000-8000-000000000000";

  // ---- the agreed 2x2 (current { notes } probe body) ----------------------
  show(
    "1  same-org  PATCH /control-assessments/:id   { notes }",
    await request(app).patch(`/api/control-assessments/${caId}`)
      .set("X-Api-Key", seed.orgA.apiKey).send(NOTES),
  );
  show(
    "2  same-org  PATCH /control-assessments/<nonexistent uuid>   { notes }",
    await request(app).patch(`/api/control-assessments/${NONEXISTENT}`)
      .set("X-Api-Key", seed.orgA.apiKey).send(NOTES),
  );
  show(
    "3  cross-org PATCH /control-assessments/:id (orgB key)   { notes }",
    await request(app).patch(`/api/control-assessments/${caId}`)
      .set("X-Api-Key", seed.orgB.apiKey).send(NOTES),
  );

  // ---- confirmation with a VALID body { status } --------------------------
  show(
    "4  cross-org PATCH /control-assessments/:id (orgB key)   { status } VALID body",
    await request(app).patch(`/api/control-assessments/${caId}`)
      .set("X-Api-Key", seed.orgB.apiKey).send(VALID),
  );
  show(
    "5  same-org  PATCH /control-assessments/<nonexistent uuid>   { status } VALID body",
    await request(app).patch(`/api/control-assessments/${NONEXISTENT}`)
      .set("X-Api-Key", seed.orgA.apiKey).send(VALID),
  );
  show(
    "6  same-org  PATCH /control-assessments/:id (orgA key)   { status } VALID body",
    await request(app).patch(`/api/control-assessments/${caId}`)
      .set("X-Api-Key", seed.orgA.apiKey).send(VALID),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
