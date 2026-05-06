/**
 * RR-3 — Source-text guards for the risk-treatments audit-log writes.
 *
 * The route module exports a default Router (no per-handler exports),
 * so source-text checks are the cheapest way to assert that the four
 * RR-3 fixes are wired in:
 *
 *   1.1  POST /api/risk-treatments emits risk_treatment.created
 *   1.3  PATCH metadata changes appear in metadata_diffs
 *   1.4  Terminal-state PATCH emits a second event for the parent risk
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROUTE_FILE   = resolve(__dirname, "../routes/riskTreatments.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("POST /api/risk-treatments — RR-3 fix 1.1 audit logging", () => {
  it("emits risk_treatment.created via writeAuditEvent", () => {
    expect(ROUTE_SOURCE).toMatch(/eventType:\s*["']risk_treatment\.created["']/);
    expect(ROUTE_SOURCE).toMatch(/resourceType:\s*["']risk_treatment["']/);
  });

  it("payload includes risk_id, treatment_type, status, owner fields", () => {
    // Locate the risk_treatment.created event block and check its payload.
    const m = ROUTE_SOURCE.match(
      /eventType:\s*["']risk_treatment\.created["'][\s\S]{0,800}?ipAddress/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/risk_id/);
    expect(block).toMatch(/treatment_type/);
    expect(block).toMatch(/status/);
    expect(block).toMatch(/owner/);
    expect(block).toMatch(/owner_user_id/);
    expect(block).toMatch(/due_date/);
  });

  it("captures actor + ip from the request", () => {
    // Anchor at writeAuditEvent({ and scan forward until the matching
    // close. The actor fields appear BEFORE eventType in the canonical
    // call shape, so we cannot anchor at eventType.
    const blockMatch = ROUTE_SOURCE.match(
      /writeAuditEvent\(\{[\s\S]{0,1200}?eventType:\s*["']risk_treatment\.created["'][\s\S]{0,800}?\}\);/
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    expect(block).toMatch(/actorUserId:\s*req\.userId/);
    expect(block).toMatch(/actorApiKeyId/);
    expect(block).toMatch(/ipAddress:\s*req\.ip/);
  });
});

describe("PATCH /api/risk-treatments/:id — RR-3 fix 1.3 metadata diffs", () => {
  it("locks the treatment row with TREATMENT_SELECT (all metadata cols)", () => {
    // Without all columns selected, the diff loop has nothing to compare
    // against and silently drops every metadata change.
    expect(ROUTE_SOURCE).toMatch(
      /SELECT \$\{TREATMENT_SELECT\}\s+FROM risk_treatments\s+WHERE id = \$1\s+AND organization_id = \$2\s+FOR UPDATE/
    );
  });

  it("declares METADATA_FIELDS covering all non-status mutable columns", () => {
    const m = ROUTE_SOURCE.match(/const METADATA_FIELDS\s*=\s*\[([\s\S]*?)\] as const;/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    for (const f of [
      "treatment_type",
      "owner",
      "owner_user_id",
      "due_date",
      "summary",
      "notes",
      "performed_at",
      "reviewer_id"
    ]) {
      expect(body).toContain(`"${f}"`);
    }
  });

  it("emits metadata_diffs only when at least one field changed", () => {
    // Spread-when-truthy keeps the payload small for status-only
    // transitions (riskUpdated alone) and avoids polluting the audit
    // log with empty diff objects.
    expect(ROUTE_SOURCE).toMatch(/hasMetadataDiffs\s*\?\s*\{\s*metadata_diffs\s*\}\s*:\s*\{\}/);
  });

  it("preserves the existing { from, to, riskUpdated } payload keys", () => {
    // Back-compat: any consumer reading the legacy payload shape must
    // continue to find from/to/riskUpdated at the top level.
    expect(ROUTE_SOURCE).toMatch(/from:\s*existing\.status/);
    expect(ROUTE_SOURCE).toMatch(/to:\s*input\.status/);
    expect(ROUTE_SOURCE).toMatch(/riskUpdated/);
  });
});

describe("PATCH /api/risk-treatments/:id — RR-3 fix 1.4 risk.terminal_status", () => {
  it("captures the parent risk's status BEFORE the terminal update", () => {
    // SELECT FOR UPDATE on the parent risk inside the same transaction
    // both gives us the before-status and closes the sibling-treatment
    // race window.
    expect(ROUTE_SOURCE).toMatch(
      /SELECT status FROM risks\s+WHERE id = \$1 AND organization_id = \$2 FOR UPDATE/
    );
  });

  it("emits a risk.terminal_status event scoped to the parent risk", () => {
    expect(ROUTE_SOURCE).toMatch(/eventType:\s*["']risk\.terminal_status["']/);
    expect(ROUTE_SOURCE).toMatch(/resourceType:\s*["']risk["']/);
    expect(ROUTE_SOURCE).toMatch(/resourceId:\s*existing\.risk_id/);
  });

  it("payload links back to the triggering treatment + records the transition", () => {
    const m = ROUTE_SOURCE.match(
      /eventType:\s*["']risk\.terminal_status["'][\s\S]{0,800}?ipAddress/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/triggered_by_treatment_id/);
    expect(block).toMatch(/treatment_terminal_status/);
    expect(block).toMatch(/risk_status:\s*\{\s*before:\s*riskStatusBefore,\s*after:\s*riskStatusAfter/);
  });

  it("only fires when riskUpdated and the before-status was captured", () => {
    // Defensive: don't emit a misleading event if the parent risk
    // disappeared between the lock and the read (riskStatusBefore
    // would be null).
    expect(ROUTE_SOURCE).toMatch(
      /if\s*\(\s*riskUpdated\s*&&\s*riskStatusBefore\s*!==\s*null\s*\)/
    );
  });
});
