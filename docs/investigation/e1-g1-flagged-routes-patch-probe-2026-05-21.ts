/**
 * e1-g1-flagged-routes-patch-probe-2026-05-21.ts
 *
 * E1-G1 triage: 2x2 PATCH probe for the four remaining flagged routes —
 * obligationAssessments, aiGovernanceAssessments, riskTreatments,
 * vendorReviews. Drives the real app over the throwaway harness DB. For each
 * route it runs the invalid `{ notes }` probe body and a valid `{ status }`
 * body. Read-only investigation — changes nothing in the codebase.
 *
 * Run:
 *   eval "$(scripts/harness-db-up.sh)"
 *   npx tsx docs/investigation/e1-g1-flagged-routes-patch-probe-2026-05-21.ts
 */
import request from "supertest";

const TARGETS = [
  "obligationAssessments",
  "aiGovernanceAssessments",
  "riskTreatments",
  "vendorReviews",
];
const NONEXISTENT = "00000000-0000-4000-8000-000000000000";
const VALID_BODY = { status: "in_progress" };

async function main(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set");

  process.env.DATABASE_URL = testUrl;
  process.env.DATABASE_SSL_DISABLED = "true";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  const { bootstrapTestDb } = await import("../../test/isolation/testDb.js");
  const seed = await bootstrapTestDb();
  const { createApp } = await import("../../src/api/app.js");
  const { V1_ROUTES } = await import("../../test/isolation/routeManifest.js");
  const app = createApp({ isDev: false, publicApiDisabled: false });

  const byName = (n: string): any => V1_ROUTES.find((r: any) => r.name === n);

  async function create(
    entry: any,
    apiKey: string,
    deps: Record<string, string>,
  ): Promise<string> {
    const res = await request(app)
      .post(entry.createPath)
      .set("X-Api-Key", apiKey)
      .send(entry.buildCreateBody(deps));
    const id = entry.extractId(res.body);
    if (res.status !== entry.createStatus || !id) {
      throw new Error(
        `create ${entry.name} failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return id;
  }

  const show = (label: string, res: { status: number; body: unknown }): void => {
    console.log(
      `  [${label}]  ${res.status}  ${JSON.stringify(res.body).slice(0, 150)}`,
    );
  };

  for (const name of TARGETS) {
    const entry = byName(name);
    const dep = byName(entry.dependsOn[0]);
    console.log(`\n======== ${name} ========`);

    const depId = await create(dep, seed.orgA.apiKey, {});
    const resId = await create(entry, seed.orgA.apiKey, { [dep.name]: depId });

    const patchEp = entry.idEndpoints.find((e: any) => e.method === "PATCH");
    const path = (id: string): string => patchEp.path.replace(":id", id);
    const notesBody = patchEp.body ?? {};
    console.log(
      `  seeded orgA ${name} id=${resId}\n` +
        `  invalid probe body (manifest): ${JSON.stringify(notesBody)}` +
        `   valid body: ${JSON.stringify(VALID_BODY)}`,
    );

    // 2x2 with the current invalid { notes } probe body.
    show(
      "1 same-org  :id            {notes}",
      await request(app).patch(path(resId)).set("X-Api-Key", seed.orgA.apiKey).send(notesBody),
    );
    show(
      "2 same-org  nonexistent    {notes}",
      await request(app).patch(path(NONEXISTENT)).set("X-Api-Key", seed.orgA.apiKey).send(notesBody),
    );
    show(
      "3 cross-org :id            {notes}",
      await request(app).patch(path(resId)).set("X-Api-Key", seed.orgB.apiKey).send(notesBody),
    );
    // Confirmation with a valid { status } body.
    show(
      "4 cross-org :id            {status} VALID",
      await request(app).patch(path(resId)).set("X-Api-Key", seed.orgB.apiKey).send(VALID_BODY),
    );
    show(
      "5 same-org  nonexistent    {status} VALID",
      await request(app).patch(path(NONEXISTENT)).set("X-Api-Key", seed.orgA.apiKey).send(VALID_BODY),
    );
    show(
      "6 same-org  :id            {status} VALID",
      await request(app).patch(path(resId)).set("X-Api-Key", seed.orgA.apiKey).send(VALID_BODY),
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
