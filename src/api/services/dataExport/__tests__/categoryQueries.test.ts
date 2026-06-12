/**
 * categoryQueries.test.ts — predicate construction for the self-export query
 * builders (Decisions Q5/Q6/Q3). No DB; asserts SQL text + bound values.
 */

import { describe, it, expect } from "vitest";
import {
  buildCategoryAQuery,
  buildCategoryBQueries,
  buildCategoryCQueries,
  buildEmailKeyedQueries,
  buildCategoryQueries,
  EXPORT_EXCLUDED_TABLES,
} from "../categoryQueries";
import type { ExportSubject } from "../types";

const subject: ExportSubject = {
  userId: "11111111-1111-1111-1111-111111111111",
  userEmail: "alice@example.com",
  orgId: "22222222-2222-2222-2222-222222222222",
};

const byTable = (qs: { table: string }[]) => new Map(qs.map((q) => [q.table, q]));

// Stub live-column lists for the tables that require an explicit projection
// (those with exportExcludedColumns) — mirrors what columnProbe.getTableColumns
// would return from information_schema.
const USERS_SECRETS = [
  "password_hash",
  "totp_secret",
  "totp_backup_codes",
  "email_verification_token",
  "email_verification_expires_at",
  "password_reset_token",
  "password_reset_expires_at",
];
const tableColumns = {
  users: [
    "id",
    "organization_id",
    "email",
    "name",
    "role",
    "status",
    "created_at",
    ...USERS_SECRETS,
  ],
  org_invites: [
    "id",
    "organization_id",
    "invited_by_user_id",
    "email",
    "role",
    "token",
    "status",
    "expires_at",
    "created_at",
    "accepted_at",
  ],
};

describe("Category A", () => {
  it("projects the subject's users row by id with secrets excluded (no SELECT *)", () => {
    const q = buildCategoryAQuery(subject, tableColumns);
    expect(q.table).toBe("users");
    expect(q.category).toBe("A");
    expect(q.values).toEqual([subject.userId]);
    expect(q.text).toMatch(/^SELECT .+ FROM users WHERE id = \$1$/);
    expect(q.text).not.toContain("*"); // explicit projection, not SELECT *
    // non-secret columns are present...
    expect(q.text).toContain('"id"');
    expect(q.text).toContain('"email"');
    // ...and every excluded secret column is absent.
    for (const secret of USERS_SECRETS) {
      expect(q.text, `users projection must not contain ${secret}`).not.toContain(secret);
    }
  });

  it("throws fail-closed when the users column list is not supplied (no SELECT *)", () => {
    expect(() => buildCategoryAQuery(subject)).toThrow(/exportExcludedColumns|SELECT \*/);
  });
});

describe("Category B", () => {
  const map = byTable(buildCategoryBQueries(subject, tableColumns));

  it("matches a no-exclusion table with SELECT * by its UUID user column", () => {
    expect(map.get("legal_consents")).toMatchObject({
      category: "B",
      text: "SELECT * FROM legal_consents WHERE user_id = $1",
      values: [subject.userId],
    });
  });

  it("projects org_invites without its live token (no SELECT *), matched by invited_by_user_id", () => {
    const q = map.get("org_invites");
    expect(q?.text).toMatch(/^SELECT .+ FROM org_invites WHERE invited_by_user_id = \$1$/);
    expect(q?.text).not.toContain("*");
    expect(q?.text).not.toContain('"token"'); // the live invite capability is excluded
    expect(q?.text).toContain('"invited_by_user_id"');
    expect(q?.values).toEqual([subject.userId]);
  });

  it("excludes password_history from the export", () => {
    expect(map.has("password_history")).toBe(false);
    expect(EXPORT_EXCLUDED_TABLES.has("password_history")).toBe(true);
  });

  it("throws fail-closed when the org_invites column list is not supplied", () => {
    expect(() => buildCategoryBQueries(subject)).toThrow(/org_invites/);
  });
});

describe("Category C — UUID vs legacy-TEXT actor matching (Q5)", () => {
  const map = byTable(buildCategoryCQueries(subject));

  it("treats a legacy-TEXT reviewer_id table as (uuid = id OR text = email)", () => {
    // risk_treatments: reviewer_uuid (UUID), owner_user_id (UUID), reviewer_id (TEXT)
    expect(map.get("risk_treatments")).toMatchObject({
      text: "SELECT * FROM risk_treatments WHERE reviewer_uuid = $1 OR owner_user_id = $1 OR reviewer_id = $2",
      values: [subject.userId, subject.userEmail],
    });
  });

  it("treats a UUID-typed reviewer_id table as id-only (control_assessments)", () => {
    expect(map.get("control_assessments")).toMatchObject({
      text: "SELECT * FROM control_assessments WHERE reviewer_id = $1",
      values: [subject.userId],
    });
  });

  it("includes vendor_assurance_documents.approved_by_user_id (Q4)", () => {
    expect(map.get("vendor_assurance_documents")?.text).toContain("approved_by_user_id = $1");
  });
});

describe("Category C — dependency_assessments reviewer_uuid probe (Q3)", () => {
  it("includes reviewer_uuid when the column is present (default)", () => {
    const map = byTable(buildCategoryCQueries(subject));
    expect(map.get("dependency_assessments")).toMatchObject({
      text: "SELECT * FROM dependency_assessments WHERE reviewer_uuid = $1 OR reviewer_id = $2",
      values: [subject.userId, subject.userEmail],
    });
  });

  it("falls back to legacy reviewer_id only when reviewer_uuid is absent", () => {
    const map = byTable(
      buildCategoryCQueries(subject, { dependencyAssessmentsReviewerUuidPresent: false }),
    );
    const q = map.get("dependency_assessments");
    expect(q).toMatchObject({
      text: "SELECT * FROM dependency_assessments WHERE reviewer_id = $1",
      values: [subject.userEmail],
    });
    expect(q?.note).toMatch(/reviewer_uuid absent/i);
  });
});

describe("email-keyed tables (Q6)", () => {
  const map = byTable(buildEmailKeyedQueries(subject));

  it("matches subscribers by email", () => {
    expect(map.get("subscribers")).toMatchObject({
      category: "E",
      text: "SELECT * FROM subscribers WHERE email = $1",
      values: [subject.userEmail],
    });
  });

  it("matches newsletter_deliveries by subscriber_email", () => {
    expect(map.get("newsletter_deliveries")?.text).toBe(
      "SELECT * FROM newsletter_deliveries WHERE subscriber_email = $1",
    );
  });

  it("does not include email_suppressions (excluded per O-8)", () => {
    expect(map.has("email_suppressions")).toBe(false);
  });
});

describe("buildCategoryQueries aggregate", () => {
  it("produces exactly one query per included table and binds only user identifiers", () => {
    const qs = buildCategoryQueries(subject, {}, tableColumns);
    const tables = qs.map((q) => q.table);
    expect(new Set(tables).size).toBe(tables.length); // no duplicate tables
    for (const q of qs) {
      // values only ever contain the subject's id and/or email — never the orgId.
      for (const v of q.values) {
        expect([subject.userId, subject.userEmail]).toContain(v);
      }
      expect(q.values).not.toContain(subject.orgId);
    }
  });
});
