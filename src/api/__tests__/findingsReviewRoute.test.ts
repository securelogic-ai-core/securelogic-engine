/**
 * Guards for POST /api/findings/:id/review (Mark Reviewed).
 *
 * Mark Reviewed is a per-USER acknowledgement that advances the caller's
 * "What's changed since your last review" baseline — NOT a status/decision
 * transition. Two properties this file pins (workflow-consistency Phase 2):
 *
 *   1. the action is AUDITED — the handler writes a `finding.reviewed` audit
 *      event (it was previously an invisible, unaudited write); and
 *   2. it remains tenant- and identity-scoped (org from organizationContext,
 *      actor = the resolved session userId), and it still does NOT mutate any
 *      finding status/decision column.
 *
 * The handler is registered inline on the findings router (no per-handler
 * export), so — exactly like risksReviewRoute.test.ts — the cheapest correctness
 * surface is source-text guards on the route block.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROUTE_FILE = resolve(__dirname, "../routes/findings.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

/** Slice the POST /findings/:id/review handler block from its opener to the
 *  next router registration (or EOF). */
function reviewRouteBlock(): string {
  const startRe = /router\.post\(\s*\n?\s*["']\/findings\/:id\/review["']/;
  const startMatch = ROUTE_SOURCE.match(startRe);
  if (!startMatch || startMatch.index === undefined) return "";
  const start = startMatch.index;
  const rest = ROUTE_SOURCE.slice(start + 1);
  const nextRe = /router\.(get|post|patch|put|delete)\(/;
  const nextMatch = rest.match(nextRe);
  const end = nextMatch && nextMatch.index !== undefined ? start + 1 + nextMatch.index : ROUTE_SOURCE.length;
  return ROUTE_SOURCE.slice(start, end);
}

const BLOCK = reviewRouteBlock();

describe("POST /findings/:id/review — Mark Reviewed", () => {
  it("locates the review handler block", () => {
    expect(BLOCK.length).toBeGreaterThan(0);
  });

  it("writes a finding.reviewed audit event (the action is no longer invisible)", () => {
    expect(BLOCK).toContain("writeAuditEvent(");
    expect(BLOCK).toContain('eventType: "finding.reviewed"');
    expect(BLOCK).toContain('resourceType: "finding"');
    expect(BLOCK).toContain("resourceId: findingId");
  });

  it("audits the RESOLVED session user as the actor, never request input", () => {
    expect(BLOCK).toContain("actorUserId: userId");
    // userId is resolved from req.userId and required (400 without it).
    expect(BLOCK).toContain("req.userId");
    expect(BLOCK).toContain('error: "review_requires_user_identity"');
  });

  it("is tenant-scoped — org from organizationContext, not the request body", () => {
    expect(BLOCK).toContain("organizationContext");
    expect(BLOCK).toContain("organizationId");
    expect(BLOCK).not.toContain("req.body.organization");
  });

  it("does NOT mutate any finding status/decision column (not a lifecycle change)", () => {
    expect(BLOCK).not.toMatch(/UPDATE\s+findings\s+SET/i);
    expect(BLOCK).not.toContain("decision_state");
  });

  it("stays dark behind the Decision Workspace flag (404 when off)", () => {
    expect(BLOCK).toContain("SECURELOGIC_DECISION_WORKSPACE_ENABLED");
  });
});
