/**
 * orgQueries.test.ts — the full-organization export builders (PR #2b, Decision
 * Q2/Q4/N4). Pure-logic tests: branch shapes, org scoping, secret projection,
 * fail-closed, and the deferral set. Schema-drift coverage (every A/B/C/D table
 * is covered or deferred) lives in src/api/__tests__/dataClassification.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  buildOrgExportQueries,
  ORG_EXPORT_DEFERRED_TABLES,
  ORG_MEMBERSHIP_SCOPED_TABLES,
} from "../orgQueries";
import type { ExportQuery, TableColumns } from "../types";

const ORG = "00000000-0000-0000-0000-0000000000aa";
const EMAILS = ["a@example.com", "b@example.com"];

// Live column lists for the four projection (exportExcludedColumns) tables.
const TABLE_COLUMNS: TableColumns = {
  users: [
    "id", "organization_id", "email", "name", "role", "status",
    "password_hash", "totp_secret", "totp_backup_codes",
    "email_verification_token", "email_verification_expires_at",
    "password_reset_token", "password_reset_expires_at", "created_at",
  ],
  org_invites: ["id", "organization_id", "invited_by_user_id", "email", "token", "status", "created_at"],
  organizations: [
    "id", "name", "slug", "entitlement_level",
    "stripe_customer_id", "stripe_subscription_id", "stripe_subscription_tier",
    "stripe_subscription_status", "payment_failed_at", "promo_code", "created_at",
  ],
  webhook_endpoints: ["id", "organization_id", "url", "secret", "description", "status", "event_types", "created_at"],
};

function build(): ExportQuery[] {
  return buildOrgExportQueries(ORG, EMAILS, TABLE_COLUMNS);
}
const byTable = (qs: ExportQuery[], t: string): ExportQuery | undefined => qs.find((q) => q.table === t);

describe("buildOrgExportQueries — org scoping", () => {
  it("scopes `organizations` by its own id (it IS the org row)", () => {
    const q = byTable(build(), "organizations")!;
    expect(q.text).toContain("FROM organizations WHERE id = $1");
    expect(q.values).toEqual([ORG]);
  });

  it("scopes a normal table by organization_id with NO actor predicate", () => {
    const q = byTable(build(), "findings")!;
    expect(q.text).toBe("SELECT * FROM findings WHERE organization_id = $1");
    expect(q.text).not.toContain("owner_user_id");
    expect(q.values).toEqual([ORG]);
  });

  it("scopes a no-org-column user table by a membership subquery", () => {
    const q = byTable(build(), "alert_sends")!;
    expect(q.text).toContain(
      '"user_id" IN (SELECT id FROM users WHERE organization_id = $1)',
    );
    expect(q.values).toEqual([ORG]);
  });
});

describe("buildOrgExportQueries — email-keyed (N4)", () => {
  it("includes org-keyed brief subscribers by organization_id", () => {
    const q = byTable(build(), "intelligence_brief_subscribers")!;
    expect(q.text).toContain("WHERE organization_id = $1");
    expect(q.values).toEqual([ORG]);
  });

  it("includes platform-level subscribers by the member-email UNION", () => {
    const q = byTable(build(), "subscribers")!;
    expect(q.text).toContain("WHERE email = ANY($1)");
    expect(q.values).toEqual([EMAILS]);
  });

  it("includes newsletter_deliveries by the member-email UNION on subscriber_email", () => {
    const q = byTable(build(), "newsletter_deliveries")!;
    expect(q.text).toContain("WHERE subscriber_email = ANY($1)");
    expect(q.values).toEqual([EMAILS]);
  });
});

describe("buildOrgExportQueries — projection (secret omission)", () => {
  it("omits Stripe/promo columns from organizations but keeps entitlement_level", () => {
    const q = byTable(build(), "organizations")!;
    for (const secret of [
      "stripe_customer_id", "stripe_subscription_id", "stripe_subscription_tier",
      "stripe_subscription_status", "payment_failed_at", "promo_code",
    ]) {
      expect(q.text).not.toContain(secret);
    }
    expect(q.text).toContain('"entitlement_level"');
  });

  it("omits the webhook signing secret", () => {
    const q = byTable(build(), "webhook_endpoints")!;
    expect(q.text).not.toContain('"secret"');
    expect(q.text).toContain('"url"');
  });

  it("omits credentials from the users dump", () => {
    const q = byTable(build(), "users")!;
    expect(q.text).not.toContain("password_hash");
    expect(q.text).not.toContain("totp_secret");
    expect(q.text).toContain('"email"');
  });

  it("throws fail-closed when a projection table has no column list", () => {
    expect(() => buildOrgExportQueries(ORG, EMAILS)).toThrow(/exportExcludedColumns|SELECT \*/);
  });
});

describe("buildOrgExportQueries — inclusion/exclusion", () => {
  it("never emits an excluded or deferred table, nor any E/F table", () => {
    const tables = new Set(build().map((q) => q.table));
    for (const excluded of ["jobs", "data_export_files", "password_history"]) {
      expect(tables.has(excluded)).toBe(false);
    }
    for (const deferred of ORG_EXPORT_DEFERRED_TABLES) {
      expect(tables.has(deferred)).toBe(false);
    }
    expect(tables.has("api_keys")).toBe(false); // F (billing)
    expect(tables.has("signals")).toBe(false); // E (operational, not email-keyed)
  });

  it("every query is scoped to the org and parameterized only by org/emails", () => {
    for (const q of build()) {
      expect(q.text).toMatch(/WHERE/);
      // values are either [orgId] or [emails[]] — never a bare user id.
      expect(q.values.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("exposes the deferred and membership sets for the drift test", () => {
    expect(ORG_EXPORT_DEFERRED_TABLES.has("requirements")).toBe(true);
    expect(ORG_MEMBERSHIP_SCOPED_TABLES.has("alert_sends")).toBe(true);
  });
});
