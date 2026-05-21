/**
 * routeManifest.ts — v1 route manifest for the cross-org isolation harness
 * (audit finding E1-G1).
 *
 * Each entry describes one customer-data resource primitive: how to CREATE
 * an instance (as org A) and which `/:id` endpoints to PROBE with org B's
 * API key. The harness asserts every cross-org probe returns HTTP 404.
 *
 * Tenancy classification is derived from TENANT_ROUTE_CLASSIFICATION.md and
 * TENANT_ISOLATION_STANDARD.md §4. Only `org-scoped` resources get a
 * cross-org-404 probe — `global` data (organization_id IS NULL: CISA / NVD /
 * MITRE / regulatory feeds) is identical for every org and MUST NOT be
 * probed, because a 200 there is correct behaviour, not a leak.
 *
 * Enum values below are taken verbatim from the route validators in
 * src/api/lib/*Validation.ts so create calls pass validation.
 */

export type Tenancy = "org-scoped" | "global" | "mixed";
export type ProbeMethod = "GET" | "PATCH";

/** A `/:id` endpoint probed cross-org. */
export interface IdEndpoint {
  method: ProbeMethod;
  /** Path with a literal `:id` placeholder, e.g. `/api/vendors/:id`. */
  path: string;
  /**
   * Request body for PATCH probes. It MUST be a body the route's validator
   * accepts: PATCH routes validate the body BEFORE the org-scoped row
   * lookup, so an invalid body returns 400 at validation and the cross-org
   * 404 path is never reached — silently masking the isolation check.
   * E1-G1's first run hit exactly this — `{ notes }` 400'd the five
   * status-transition routes, which require a valid `status` — so those
   * five carry a `{ status }` body. See docs/investigation/.
   */
  body?: Record<string, unknown>;
}

export interface RouteEntry {
  /** Stable key — also the dependency key other entries reference. */
  name: string;
  tenancy: Tenancy;
  /** POST create endpoint. */
  createPath: string;
  /** Expected create status (201 for all v1 resources). */
  createStatus: number;
  /** Resource keys that must be created first, in the same org. */
  dependsOn: string[];
  /** Build the create body; `deps` maps a dependency name to its created id. */
  buildCreateBody: (deps: Record<string, string>) => Record<string, unknown>;
  /** Pull the new resource id out of the create response body. */
  extractId: (body: any) => string | undefined;
  /**
   * For routes whose GET /:id returns a multi-key envelope (e.g.
   * `{ assessment, finding }`), the envelope key under which the resource
   * itself lives. When set, the harness resolves ONLY `body[resourceKey]`
   * for id / organization_id assertions — it never falls back to a
   * heuristic, so a sibling object (the linked `finding`) can never stand in
   * for the resource. Omit for top-level or single-key-wrapped responses.
   */
  resourceKey?: string;
  /** `/:id` endpoints probed cross-org. */
  idEndpoints: IdEndpoint[];
}

const PROBE_NOTE = "harness cross-org probe";

/**
 * Resolve the created resource id from a create response. Routes return the
 * resource either at the top level (`{ id, ... }`) or wrapped under a single
 * resource key (`{ vendor: { id, ... } }`). Both shapes are handled.
 */
function topLevelId(b: any): string | undefined {
  if (!b || typeof b !== "object") return undefined;
  if (typeof b.id === "string") return b.id;
  for (const value of Object.values(b)) {
    if (value && typeof value === "object" && typeof (value as any).id === "string") {
      return (value as any).id;
    }
  }
  return undefined;
}

/**
 * v1 boundary: customer-data primitives exposing GET/PATCH /api/<resource>/:id.
 * DELETE endpoints are excluded from v1 — controls and ai-systems gate DELETE
 * behind requireAuth (JWT), which the API-key harness cannot satisfy; a JWT
 * harness covering DELETE is phase 2.
 */
export const V1_ROUTES: RouteEntry[] = [
  // ---- base resources (no dependencies) ----------------------------------
  {
    name: "vendors",
    tenancy: "org-scoped",
    createPath: "/api/vendors",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({ name: `Harness Vendor ${Date.now()}` }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/vendors/:id" },
      { method: "PATCH", path: "/api/vendors/:id", body: { service_description: PROBE_NOTE } },
    ],
  },
  {
    name: "risks",
    tenancy: "org-scoped",
    createPath: "/api/risks",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({
      title: `Harness Risk ${Date.now()}`,
      domain: "General",
      status: "open",
      likelihood: "possible",
      impact: "Moderate",
      risk_rating: "Moderate",
      inherent_likelihood: "possible",
      inherent_impact: "Moderate",
      inherent_rating: "Moderate",
      residual_likelihood: "possible",
      residual_impact: "Moderate",
      residual_rating: "Moderate",
    }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/risks/:id" },
      { method: "PATCH", path: "/api/risks/:id", body: { description: PROBE_NOTE } },
    ],
  },
  {
    name: "controls",
    tenancy: "org-scoped",
    createPath: "/api/controls",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({ name: `Harness Control ${Date.now()}` }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/controls/:id" },
      { method: "PATCH", path: "/api/controls/:id", body: { description: PROBE_NOTE } },
    ],
  },
  {
    name: "obligations",
    tenancy: "org-scoped",
    createPath: "/api/obligations",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({
      title: `Harness Obligation ${Date.now()}`,
      status: "active",
      description: PROBE_NOTE,
      source_regulation: "Harness Reg",
      jurisdiction: "US",
      domain: "General",
      priority: "planned",
      due_date: "2026-12-31",
    }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/obligations/:id" },
      { method: "PATCH", path: "/api/obligations/:id", body: { notes: PROBE_NOTE } },
    ],
  },
  {
    name: "aiSystems",
    tenancy: "org-scoped",
    createPath: "/api/ai-systems",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({ name: `Harness AI System ${Date.now()}` }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/ai-systems/:id" },
      { method: "PATCH", path: "/api/ai-systems/:id", body: { use_case: PROBE_NOTE } },
    ],
  },
  {
    name: "policies",
    tenancy: "org-scoped",
    createPath: "/api/policies",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({ name: `Harness Policy ${Date.now()}` }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/policies/:id" },
      { method: "PATCH", path: "/api/policies/:id", body: { description: PROBE_NOTE } },
    ],
  },
  {
    name: "findings",
    tenancy: "org-scoped",
    createPath: "/api/findings",
    createStatus: 201,
    dependsOn: [],
    buildCreateBody: () => ({
      title: `Harness Finding ${Date.now()}`,
      // description is a required, non-empty field on POST /api/findings.
      description: "Harness cross-org isolation probe finding.",
      severity: "Moderate",
      source_type: "manual",
    }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/findings/:id" },
      // findings PATCH updatable fields are status/priority/owner_user_id/
      // due_date; `status` is validated against VALID_PATCH_STATUSES.
      { method: "PATCH", path: "/api/findings/:id", body: { status: "in_progress" } },
    ],
  },

  // ---- dependent resources (need a same-org parent) ----------------------
  {
    name: "vendorReviews",
    tenancy: "org-scoped",
    createPath: "/api/vendor-reviews",
    createStatus: 201,
    dependsOn: ["vendors"],
    buildCreateBody: (deps) => ({ vendor_id: deps.vendors, status: "not_started" }),
    extractId: topLevelId,
    // GET /:id returns `{ review, finding }` — resolve the review explicitly.
    resourceKey: "review",
    idEndpoints: [
      { method: "GET", path: "/api/vendor-reviews/:id" },
      { method: "PATCH", path: "/api/vendor-reviews/:id", body: { status: "in_progress" } },
    ],
  },
  {
    name: "vendorAssessments",
    tenancy: "org-scoped",
    createPath: "/api/vendor-assessments",
    createStatus: 201,
    dependsOn: ["vendors"],
    buildCreateBody: (deps) => ({
      vendor_id: deps.vendors,
      assessment_type: "security",
      overall_severity: "Moderate",
    }),
    // POST returns `{ assessment, finding }`; resolve the assessment
    // explicitly so the linked finding can never be mistaken for the
    // created resource (topLevelId would pick it only by key order).
    extractId: (b) => topLevelId((b as any)?.assessment),
    // GET /:id also returns `{ assessment, finding }`.
    resourceKey: "assessment",
    // vendor-assessments expose GET /:id only (immutable once created).
    idEndpoints: [{ method: "GET", path: "/api/vendor-assessments/:id" }],
  },
  {
    name: "riskTreatments",
    tenancy: "org-scoped",
    createPath: "/api/risk-treatments",
    createStatus: 201,
    dependsOn: ["risks"],
    buildCreateBody: (deps) => ({ risk_id: deps.risks, status: "not_started" }),
    extractId: topLevelId,
    idEndpoints: [
      { method: "GET", path: "/api/risk-treatments/:id" },
      { method: "PATCH", path: "/api/risk-treatments/:id", body: { status: "in_progress" } },
    ],
  },
  {
    name: "controlAssessments",
    tenancy: "org-scoped",
    createPath: "/api/control-assessments",
    createStatus: 201,
    dependsOn: ["controls"],
    buildCreateBody: (deps) => ({ control_id: deps.controls, status: "not_started" }),
    extractId: topLevelId,
    // GET /:id returns `{ assessment, finding }` — resolve the assessment explicitly.
    resourceKey: "assessment",
    idEndpoints: [
      { method: "GET", path: "/api/control-assessments/:id" },
      { method: "PATCH", path: "/api/control-assessments/:id", body: { status: "in_progress" } },
    ],
  },
  {
    name: "obligationAssessments",
    tenancy: "org-scoped",
    createPath: "/api/obligation-assessments",
    createStatus: 201,
    dependsOn: ["obligations"],
    buildCreateBody: (deps) => ({ obligation_id: deps.obligations, status: "not_started" }),
    extractId: topLevelId,
    // GET /:id returns `{ assessment, finding }` — resolve the assessment explicitly.
    resourceKey: "assessment",
    idEndpoints: [
      { method: "GET", path: "/api/obligation-assessments/:id" },
      { method: "PATCH", path: "/api/obligation-assessments/:id", body: { status: "in_progress" } },
    ],
  },
  {
    name: "aiGovernanceAssessments",
    tenancy: "org-scoped",
    createPath: "/api/ai-governance-assessments",
    createStatus: 201,
    dependsOn: ["aiSystems"],
    buildCreateBody: (deps) => ({ ai_system_id: deps.aiSystems, status: "not_started" }),
    extractId: topLevelId,
    // GET /:id returns `{ assessment, finding }` — resolve the assessment explicitly.
    resourceKey: "assessment",
    idEndpoints: [
      { method: "GET", path: "/api/ai-governance-assessments/:id" },
      { method: "PATCH", path: "/api/ai-governance-assessments/:id", body: { status: "in_progress" } },
    ],
  },
];

/**
 * Routes inside the E1-G1 v1 intent but deferred to phase 2, recorded so the
 * deferral is explicit rather than a silent gap.
 */
export const DEFERRED_ROUTES: { name: string; reason: string }[] = [
  {
    name: "assessments",
    reason:
      "GET /api/assessments/:id has no POST create endpoint — instances are " +
      "produced by other workflows. Needs a direct-SQL seed path; phase 2.",
  },
  {
    name: "dependencyAssessments",
    reason:
      "Requires a 3-deep prerequisite chain (ai-system + vendor + " +
      "ai_system_vendor_dependencies link) before a dependency-assessment " +
      "can be created; phase 2.",
  },
  {
    name: "vendorAssuranceDocuments",
    reason:
      "Gated behind the vendorAssuranceFeatureFlag and requires a multipart " +
      "PDF upload (magic-byte checked). Needs flag + fixture wiring; phase 2.",
  },
  {
    name: "controls/aiSystems DELETE",
    reason:
      "DELETE /:id on controls and ai-systems is gated behind requireAuth " +
      "(JWT). The API-key harness cannot mint a JWT session; a JWT-auth " +
      "harness covering DELETE is phase 2.",
  },
];
