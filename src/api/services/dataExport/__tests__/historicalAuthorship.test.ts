/**
 * historicalAuthorship.test.ts — the security_audit_log actor query (O-1 / Q7).
 */

import { describe, it, expect } from "vitest";
import { buildHistoricalAuthorshipQuery } from "../historicalAuthorship";
import type { ExportSubject } from "../types";

const subject: ExportSubject = {
  userId: "11111111-1111-1111-1111-111111111111",
  userEmail: "alice@example.com",
  orgId: "22222222-2222-2222-2222-222222222222",
};

describe("buildHistoricalAuthorshipQuery", () => {
  it("selects full audit rows where the subject is the actor (UUID only)", () => {
    const q = buildHistoricalAuthorshipQuery(subject);
    expect(q).toMatchObject({
      table: "security_audit_log",
      text: "SELECT * FROM security_audit_log WHERE actor_user_id = $1",
      values: [subject.userId],
    });
  });

  it("uses SELECT * so ip_address comes along, and does not reference user_agent", () => {
    // user_agent is NOT a security_audit_log column (it lives on legal_consents).
    const q = buildHistoricalAuthorshipQuery(subject);
    expect(q.text).toContain("SELECT *");
    expect(q.text).not.toContain("user_agent");
  });

  it("does not match by email (no email actor column on this table)", () => {
    const q = buildHistoricalAuthorshipQuery(subject);
    expect(q.values).not.toContain(subject.userEmail);
  });
});
