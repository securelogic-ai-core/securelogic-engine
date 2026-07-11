/**
 * findingContext.test.ts — ERIP Package 3 (Decision Workspace), Phase 3.0.
 *
 * Real-Postgres cross-org isolation for the Finding Context Resolver: a
 * signal-sourced finding resolves its affected vendor + evidence for its own org;
 * another org gets null for that finding (no cross-tenant read); and the resolver
 * never mixes another org's affected entities into the context.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedCyberSignal, seedUser, type TestDbSeed } from "./testDb.js";
import { resolveFindingContext } from "../../src/api/lib/findingContextResolver.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedSignalSourcedFinding(orgId: string, dedup: string) {
  const signalId = await seedCyberSignal(pool, { orgId, dedup, vendor: "Acme" });
  const vendorId = await seedVendor(pool, orgId, { name: `Vendor-${dedup}` });
  await pool.query(
    `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id) VALUES ($1, $2, $3)`,
    [orgId, signalId, vendorId]
  );
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Ctx finding', 'high', 'ctx', 'cyber_signal', $2)
     RETURNING id`,
    [orgId, signalId]
  );
  const findingId = f.rows[0].id;
  await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1, 'finding', $2, 'advisory.pdf', 'document')`,
    [orgId, findingId]
  );
  return { signalId, vendorId, findingId };
}

async function seedVendorReviewFinding(orgId: string, dedup: string) {
  const vendorId = await seedVendor(pool, orgId, { name: `AsmtVendor-${dedup}` });
  const va = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security', 'High') RETURNING id`,
    [orgId, vendorId]
  );
  const assessmentId = va.rows[0].id;
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Vendor review finding', 'high', 'ctx', 'vendor_review', $2)
     RETURNING id`,
    [orgId, assessmentId]
  );
  return { vendorId, assessmentId, findingId: f.rows[0].id };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding-context test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("Package 3 Phase 3.0 — finding context resolver (real Postgres)", () => {
  it("resolves the affected vendor + evidence for a signal-sourced finding", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-1");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors.map((v) => v.id)).toContain(a.vendorId);
    expect(ctx!.evidence.length).toBe(1);
    expect(ctx!.finding.source_type).toBe("cyber_signal");
    // Phase 3.1 — risk score + business impact composed from real data.
    expect(typeof ctx!.risk.score).toBe("number");
    expect(ctx!.business_impact.third_party.level).not.toBe("none"); // 1 affected vendor
    // `revenue` used to be asserted here as a permanent "not_assessed". It is gone:
    // an unsourceable dimension earns no row at all rather than a placeholder one.
    expect(ctx!.business_impact).not.toHaveProperty("revenue");
    expect(ctx!.business_impact).not.toHaveProperty("customer");
    // Phase 3.2a — decision_state (business decision) present + defaulted.
    expect(ctx!.finding.decision_state).toBe("needs_review");
  });

  it("finding_review_marks (What's-Changed) is org-scoped", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-4");
    const user = await seedUser(pool, seed.orgA.id, {});
    await pool.query(
      `INSERT INTO finding_review_marks (organization_id, finding_id, user_id) VALUES ($1, $2, $3)`,
      [seed.orgA.id, a.findingId, user.id]
    );
    const inA = await pool.query(
      `SELECT 1 FROM finding_review_marks WHERE organization_id = $1 AND finding_id = $2`,
      [seed.orgA.id, a.findingId]
    );
    expect(inA.rowCount).toBe(1);
    const inB = await pool.query(
      `SELECT 1 FROM finding_review_marks WHERE organization_id = $1 AND finding_id = $2`,
      [seed.orgB.id, a.findingId]
    );
    expect(inB.rowCount).toBe(0);
  });

  it("resolves the affected vendor for an assessment-sourced (vendor_review) finding", async () => {
    // §6 source-consistency: assessment-sourced findings resolve affected context too.
    const a = await seedVendorReviewFinding(seed.orgA.id, "asmt-a-1");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.finding.source_type).toBe("vendor_review");
    expect(ctx!.affected.vendors.map((v) => v.id)).toEqual([a.vendorId]);
  });

  it("never leaks another org's vendor via an assessment-sourced finding", async () => {
    const a = await seedVendorReviewFinding(seed.orgA.id, "asmt-a-2");
    await seedVendorReviewFinding(seed.orgB.id, "asmt-b-2");
    const ctxA = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctxA!.affected.vendors.every((v) => v.id === a.vendorId)).toBe(true);
    // Another org cannot read this finding's context at all.
    expect(await resolveFindingContext(pool, seed.orgB.id, a.findingId)).toBeNull();
  });

  it("returns null for another org's finding (no cross-tenant read)", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-2");
    const ctx = await resolveFindingContext(pool, seed.orgB.id, a.findingId);
    expect(ctx).toBeNull();
  });

  it("never mixes another org's affected entities into the context", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-3");
    await seedSignalSourcedFinding(seed.orgB.id, "ctx-b-3");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors.every((v) => v.id === a.vendorId)).toBe(true);
  });
});

// ── Context Contract (event-native vendors, resolution status, candidates) ──

async function seedIntelligenceEvent(dedup: string, affectedVendor: string | null) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO intelligence_events (canonical_key, title, event_type, severity, affected_vendor)
     VALUES ($1, $2, 'vulnerability', 'High', $3)
     RETURNING id`,
    [`ctxc-${dedup}`, `Event ${dedup}`, affectedVendor]
  );
  return r.rows[0].id;
}

async function seedEventSourcedFinding(orgId: string, eventId: string) {
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Event finding', 'high', 'ctx', 'intelligence_event', $2)
     RETURNING id`,
    [orgId, eventId]
  );
  return f.rows[0].id;
}

describe("Context Contract — event-native vendor resolution", () => {
  it("a Microsoft-linked event finding shows Microsoft as affected (same match that created it)", async () => {
    // The org tracks the vendor with case/whitespace variance — the resolver
    // must use the SAME lower(trim(name)) equality as the relevance gate.
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Microsoft Corporation" });
    const eventId = await seedIntelligenceEvent("ms-1", "  microsoft corporation ");
    const findingId = await seedEventSourcedFinding(seed.orgA.id, eventId);

    const ctx = await resolveFindingContext(pool, seed.orgA.id, findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors.map((v) => v.id)).toContain(vendorId);
    expect(ctx!.affected.resolution.vendors).toBe("resolved");
    // Business impact reflects the resolved vendor — no more "Low/None" lie.
    expect(ctx!.business_impact.third_party.level).not.toBe("none");
    expect(ctx!.business_impact.third_party.level).not.toBe("not_assessed");
  });

  it("never resolves an event vendor across orgs", async () => {
    // Org B tracks the vendor; org A does NOT. Org A's finding must not surface it.
    await seedVendor(pool, seed.orgB.id, { name: "Contoso Ltd" });
    const eventId = await seedIntelligenceEvent("contoso-1", "Contoso Ltd");
    const findingId = await seedEventSourcedFinding(seed.orgA.id, eventId);

    const ctx = await resolveFindingContext(pool, seed.orgA.id, findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors).toEqual([]);
    // The event-native path RAN (event ids exist) and found nothing → honest zero.
    expect(ctx!.affected.resolution.vendors).toBe("none_found");
  });
});

describe("Context Contract — resolution status (empty ≠ zero ≠ unknowable)", () => {
  it("manual findings are not_applicable everywhere and impact is not_assessed, not 'none'", async () => {
    const f = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type)
       VALUES ($1, 'Manual finding', 'high', 'ctx', 'manual')
       RETURNING id`,
      [seed.orgA.id]
    );
    const ctx = await resolveFindingContext(pool, seed.orgA.id, f.rows[0].id);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.resolution).toEqual({
      vendors: "not_applicable",
      ai_systems: "not_applicable",
      controls: "not_applicable",
      obligations: "not_applicable",
    });
    // The producer never asserts "No affected vendors" about an unsourceable dim.
    expect(ctx!.business_impact.third_party.level).toBe("not_assessed");
    expect(ctx!.business_impact.regulatory.level).toBe("not_assessed");
    expect(ctx!.business_impact.operational.level).toBe("not_assessed");
  });

  it("signal findings with links get resolved buckets and honest zeros elsewhere", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctxc-res-1");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx!.affected.resolution.vendors).toBe("resolved");
    // Link path ran for all four buckets; the others honestly found nothing.
    expect(ctx!.affected.resolution.ai_systems).toBe("none_found");
    expect(ctx!.affected.resolution.controls).toBe("none_found");
    expect(ctx!.affected.resolution.obligations).toBe("none_found");
  });
});

describe("Context Contract — pending suggestions surface as candidates, never as affected", () => {
  it("a pending matcher suggestion appears as a needs_review candidate", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "ctxc-sug-1", vendor: "Acme" });
    const suggestedVendor = await seedVendor(pool, seed.orgA.id, { name: "SuggestedVendor-1" });
    await pool.query(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, match_reason, match_score)
       VALUES ($1, $2, 'vendor', $3, 'vendor_name_ilike', 72)`,
      [seed.orgA.id, signalId, suggestedVendor]
    );
    const f = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
       VALUES ($1, 'Suggestion finding', 'high', 'ctx', 'cyber_signal', $2)
       RETURNING id`,
      [seed.orgA.id, signalId]
    );

    const ctx = await resolveFindingContext(pool, seed.orgA.id, f.rows[0].id);
    expect(ctx).not.toBeNull();
    // The candidate is visible AND explicitly ambiguous…
    const cand = ctx!.affected.candidates.find((c) => c.id === suggestedVendor);
    expect(cand).toBeTruthy();
    expect(cand!.status).toBe("needs_review");
    expect(cand!.match_score).toBe(72);
    // …and is NOT promoted into the affected bucket (no false certainty).
    expect(ctx!.affected.vendors.map((v) => v.id)).not.toContain(suggestedVendor);
    // Vendor bucket: link path ran, nothing accepted yet → honest zero.
    expect(ctx!.affected.resolution.vendors).toBe("none_found");
  });

  it("accepted/dismissed suggestions and other orgs' suggestions never appear", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "ctxc-sug-2", vendor: "Acme" });
    const dismissed = await seedVendor(pool, seed.orgA.id, { name: "DismissedVendor-2" });
    await pool.query(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, dismissed_at)
       VALUES ($1, $2, 'vendor', $3, NOW())`,
      [seed.orgA.id, signalId, dismissed]
    );
    // Org B has a pending suggestion on ITS OWN signal — must not leak into org A.
    const signalB = await seedCyberSignal(pool, { orgId: seed.orgB.id, dedup: "ctxc-sug-2b", vendor: "Acme" });
    const vendorB = await seedVendor(pool, seed.orgB.id, { name: "OrgBVendor-2" });
    await pool.query(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id)
       VALUES ($1, $2, 'vendor', $3)`,
      [seed.orgB.id, signalB, vendorB]
    );

    const f = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
       VALUES ($1, 'Suggestion finding 2', 'high', 'ctx', 'cyber_signal', $2)
       RETURNING id`,
      [seed.orgA.id, signalId]
    );
    const ctx = await resolveFindingContext(pool, seed.orgA.id, f.rows[0].id);
    expect(ctx!.affected.candidates).toEqual([]);
  });
});
