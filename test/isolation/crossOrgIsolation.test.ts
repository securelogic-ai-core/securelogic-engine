/**
 * crossOrgIsolation.test.ts — cross-org tenant-isolation harness (E1-G1).
 *
 * Drives the REAL application built by createApp() over a real Postgres,
 * with two real organizations and two real API keys. For every org-scoped
 * `/:id` primitive in the v1 manifest it:
 *
 *   1. creates a resource as org A and as org B (via the public POST route);
 *   2. runs a positive control — the OWNING org GETs that exact `/:id` and
 *      must 200 with its own resource (matching id + organization_id). The
 *      control and the cross-org GET probe hit the same URL and differ ONLY
 *      in which org's key is presented;
 *   3. probes every `/:id` endpoint cross-org — org B's key against org A's
 *      resource id, and the reverse.
 *
 * Symmetry is the point: same-org 200 + cross-org non-404 = real IDOR;
 * same-org non-200 = broken seed/harness, not a leak.
 *
 * HARD RULE (operator-set, E1-G1): a cross-org probe returning anything but
 * 404 is a candidate cross-tenant IDOR, never a test bug. Do not loosen this
 * assertion — surface the finding.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import {
  V1_ROUTES,
  DEFERRED_ROUTES,
  type RouteEntry,
  type ProbeMethod,
} from "./routeManifest.js";

let app: Express;
let seed: TestDbSeed;

/** created resource id per org, keyed by manifest resource name. */
const idsA: Record<string, string> = {};
const idsB: Record<string, string> = {};
/** resource names whose create failed — their probes are reported, not run. */
const createFailures: { name: string; org: "A" | "B"; status: number; body: unknown }[] = [];

interface ProbeResult {
  resource: string;
  direction: string;
  method: string;
  path: string;
  status: number;
  verdict: "pass" | "IDOR" | "non-404";
}
const probeResults: ProbeResult[] = [];

function resolvePath(template: string, id: string): string {
  return template.replace(":id", id);
}

/**
 * Issue one request against the live app. The positive control and the
 * cross-org probe both call this with the SAME method and SAME url — only
 * the apiKey differs. That is what makes the control a true mirror of the
 * probe rather than an unrelated check.
 */
function sendProbe(
  method: ProbeMethod,
  apiKey: string,
  url: string,
  body?: Record<string, unknown>,
) {
  if (method === "PATCH") {
    return request(app).patch(url).set("X-Api-Key", apiKey).send(body ?? {});
  }
  return request(app).get(url).set("X-Api-Key", apiKey);
}

/**
 * Resolve the resource object from a GET /:id response.
 *
 * - When `resourceKey` is set (routes whose response is a multi-key envelope
 *   such as `{ assessment, finding }`), resolve ONLY `body[resourceKey]`.
 *   There is no heuristic fallback: if that key is missing or malformed this
 *   returns undefined, and the positive control fails loudly. This is
 *   deliberate — the linked `finding` sibling must never stand in for the
 *   resource.
 * - Otherwise the response is top-level (`{ id, ... }`) or a single-key wrap
 *   (`{ vendor: { id, ... } }`); resolve the sole object carrying an `id`.
 */
function resourceBody(b: any, resourceKey?: string): Record<string, unknown> | undefined {
  if (!b || typeof b !== "object") return undefined;

  if (resourceKey) {
    const keyed = (b as Record<string, unknown>)[resourceKey];
    if (keyed && typeof keyed === "object" && typeof (keyed as any).id === "string") {
      return keyed as Record<string, unknown>;
    }
    return undefined; // no fallback — see doc comment.
  }

  if (typeof b.id === "string") return b as Record<string, unknown>;
  for (const value of Object.values(b)) {
    if (value && typeof value === "object" && typeof (value as any).id === "string") {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

/** The resource's own id, for confirming the body is the resource we asked for. */
function resolveBodyId(b: any, resourceKey?: string): string | undefined {
  const r = resourceBody(b, resourceKey);
  return typeof r?.id === "string" ? (r.id as string) : undefined;
}

/**
 * The owning-org id carried in the resource — the ownership-proving field.
 * Routes select `organization_id`; `organizationId` is accepted defensively.
 */
function resolveBodyOrgId(b: any, resourceKey?: string): string | undefined {
  const r = resourceBody(b, resourceKey);
  const oid = r?.organization_id ?? (r as any)?.organizationId;
  return typeof oid === "string" ? oid : undefined;
}

async function createAs(
  apiKey: string,
  entry: RouteEntry,
  deps: Record<string, string>,
): Promise<{ ok: boolean; id?: string; status: number; body: unknown }> {
  const res = await request(app)
    .post(entry.createPath)
    .set("X-Api-Key", apiKey)
    .send(entry.buildCreateBody(deps));

  if (res.status !== entry.createStatus) {
    return { ok: false, status: res.status, body: res.body };
  }
  const id = entry.extractId(res.body);
  if (!id) {
    return { ok: false, status: res.status, body: res.body };
  }
  return { ok: true, id, status: res.status, body: res.body };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  // createApp imported only now — infra/postgres.ts needs DATABASE_URL, which
  // setup.ts has set. Dynamic import keeps that ordering explicit.
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // V1_ROUTES is ordered base-resources-first, so dependsOn ids are ready.
  for (const entry of V1_ROUTES) {
    const depsA: Record<string, string> = {};
    const depsB: Record<string, string> = {};
    for (const dep of entry.dependsOn) {
      if (idsA[dep]) depsA[dep] = idsA[dep];
      if (idsB[dep]) depsB[dep] = idsB[dep];
    }

    const a = await createAs(seed.orgA.apiKey, entry, depsA);
    if (a.ok && a.id) idsA[entry.name] = a.id;
    else createFailures.push({ name: entry.name, org: "A", status: a.status, body: a.body });

    const b = await createAs(seed.orgB.apiKey, entry, depsB);
    if (b.ok && b.id) idsB[entry.name] = b.id;
    else createFailures.push({ name: entry.name, org: "B", status: b.status, body: b.body });
  }
}, 120_000);

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(
    `\n[harness] ${probeResults.length} cross-org probes across ` +
      `${V1_ROUTES.length} v1 resources; ${DEFERRED_ROUTES.length} resources deferred.`,
  );
  const bad = probeResults.filter((r) => r.verdict !== "pass");
  if (bad.length > 0) {
    // eslint-disable-next-line no-console
    console.log("[harness] NON-404 PROBES (candidate IDOR — triage required):");
    for (const r of bad) {
      // eslint-disable-next-line no-console
      console.log(`  [${r.verdict}] ${r.method} ${r.path} (${r.direction}) -> ${r.status}`);
    }
  } else if (createFailures.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[harness] all cross-org probes returned 404 — no isolation gaps found.");
  }
});

describe("E1-G1 cross-org isolation harness", () => {
  it("seeded two distinct orgs with distinct API keys", () => {
    expect(seed.orgA.id).not.toBe(seed.orgB.id);
    expect(seed.orgA.apiKey).not.toBe(seed.orgB.apiKey);
  });

  it("created every v1 resource in both orgs (harness setup)", () => {
    expect(
      createFailures,
      `resource create(s) failed — harness cannot probe these:\n` +
        JSON.stringify(createFailures, null, 2),
    ).toEqual([]);
  });

  it("deferred routes carry no cross-org probes (not in the probe set)", () => {
    // A DEFERRED_ROUTES entry must not also appear in V1_ROUTES — otherwise it
    // would be probed despite being marked deferred, making the deferral a
    // silent lie. The probe loop below iterates V1_ROUTES only.
    const probed = new Set(V1_ROUTES.map((r) => r.name));
    const deferredButProbed = DEFERRED_ROUTES.filter((d) => probed.has(d.name)).map(
      (d) => d.name,
    );
    expect(
      deferredButProbed,
      "route(s) listed in DEFERRED_ROUTES are also in V1_ROUTES — they would " +
        "be probed despite being marked deferred",
    ).toEqual([]);
  });

  for (const entry of V1_ROUTES) {
    // The GET /:id endpoint the positive control reads. Every v1 resource
    // exposes one (vendor-assessments expose GET only); guarded below.
    const getEndpoint = entry.idEndpoints.find((e) => e.method === "GET");

    describe(entry.name, () => {
      // ---- positive controls --------------------------------------------
      // The OWNING org GETs the SAME /:id the cross-org probe targets. A
      // non-200 here means the seed/harness is broken, not that anything
      // leaked — and it makes the cross-org 404s below meaningless, so it
      // must fail loudly. "Any 200" is not enough: the body must carry the
      // id we created AND the owning organization_id.
      for (const owner of ["A", "B"] as const) {
        it(`org ${owner} can GET its own ${entry.name} (positive control: 200 + ownership)`, async () => {
          expect(
            getEndpoint,
            `${entry.name} has no GET /:id endpoint to run a positive control against`,
          ).toBeDefined();

          const ownerKey = owner === "A" ? seed.orgA.apiKey : seed.orgB.apiKey;
          const ownerOrgId = owner === "A" ? seed.orgA.id : seed.orgB.id;
          const ownId = (owner === "A" ? idsA : idsB)[entry.name];
          if (!ownId) {
            // create failed — already asserted by the setup test above.
            return;
          }

          const url = resolvePath(getEndpoint!.path, ownId);
          const res = await sendProbe("GET", ownerKey, url);

          expect(
            res.status,
            `POSITIVE CONTROL FAILED: same-org GET ${url} returned ${res.status}, ` +
              `expected 200. The owning org cannot read its own resource — ` +
              `broken seed/harness, NOT an isolation leak. Cross-org probes ` +
              `for ${entry.name} are not meaningful until this passes.`,
          ).toBe(200);
          expect(
            resolveBodyId(res.body, entry.resourceKey),
            `POSITIVE CONTROL FAILED: same-org GET ${url} did not return the ` +
              `created resource (id mismatch${entry.resourceKey ? `, under "${entry.resourceKey}"` : ""}).`,
          ).toBe(ownId);
          expect(
            resolveBodyOrgId(res.body, entry.resourceKey),
            `POSITIVE CONTROL FAILED: same-org GET ${url} body does not carry ` +
              `the owning organization_id (${ownerOrgId}) — cannot prove the ` +
              `200 is org ${owner}'s own resource.`,
          ).toBe(ownerOrgId);
        });
      }

      // ---- cross-org probe matrix ---------------------------------------
      // Each /:id endpoint, both directions. A cross-org GET probe is the
      // exact mirror of the positive control above — same sendProbe() call,
      // same url, attacker's key instead of the owner's.
      for (const ep of entry.idEndpoints) {
        for (const dir of ["B->A", "A->B"] as const) {
          it(`org ${dir[0]} cannot ${ep.method} org ${dir[3]}'s ${entry.name} (404)`, async () => {
            const attackerKey = dir === "B->A" ? seed.orgB.apiKey : seed.orgA.apiKey;
            const victimId = dir === "B->A" ? idsA[entry.name] : idsB[entry.name];
            if (!victimId) {
              // create failed — already asserted by the setup test above.
              return;
            }

            const url = resolvePath(ep.path, victimId);
            const res = await sendProbe(ep.method, attackerKey, url, ep.body);

            const verdict: ProbeResult["verdict"] =
              res.status === 404
                ? "pass"
                : res.status >= 200 && res.status < 300
                  ? "IDOR"
                  : "non-404";
            probeResults.push({
              resource: entry.name,
              direction: dir,
              method: ep.method,
              path: url,
              status: res.status,
              verdict,
            });

            expect(
              res.status,
              `CROSS-ORG ${ep.method} ${ep.path} (${dir}) returned ${res.status}, ` +
                `expected 404. ${verdict === "IDOR" ? "CANDIDATE IDOR — org boundary crossed." : "Non-404 — triage per E1-G1 hard rule."}`,
            ).toBe(404);
          });
        }
      }
    });
  }
});
