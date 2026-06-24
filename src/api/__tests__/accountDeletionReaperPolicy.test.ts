/**
 * accountDeletionReaperPolicy.test.ts — pure (DB-free) coverage of the reaper
 * policy: the tombstone SQL builder (consumes the drift-tested
 * TOMBSTONE_USER_PATCH), the flag-gated claim-type set, and the settled
 * table lists. This is the highest-correctness-risk unit — a wrong tombstone
 * SET clause silently fails to scrub PII.
 */
import { describe, it, expect } from "vitest";
import {
  buildTombstoneUpdate,
  claimedJobTypes,
  accountDeletionReaperEnabled,
  DELETION_GRACE_DAYS,
  REVIEWER_TEXT_TABLES,
  CATEGORY_B_DELETE_TABLES,
  ACCOUNT_DELETION_REAP_JOB_TYPE,
} from "../lib/accountDeletionReaperPolicy.js";
import {
  TOMBSTONE_USER_PATCH,
  TOMBSTONE_PRESERVED_COLUMNS,
} from "../lib/dataClassification.js";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-06-24T12:00:00.000Z");

describe("buildTombstoneUpdate", () => {
  const { sql, params } = buildTombstoneUpdate(USER, ORG, NOW);

  it("writes a SET for every column in TOMBSTONE_USER_PATCH (nothing silently dropped)", () => {
    for (const col of Object.keys(TOMBSTONE_USER_PATCH)) {
      expect(sql).toMatch(new RegExp(`\\b${col} = \\$\\d+`));
    }
  });

  it("never SETs a preserved column (id / organization_id / role / audit fields)", () => {
    // Scope to the SET clause only — preserved id/organization_id legitimately
    // appear in the WHERE clause.
    const setClause = sql.slice(sql.indexOf("SET "), sql.indexOf(" WHERE "));
    for (const col of TOMBSTONE_PRESERVED_COLUMNS) {
      expect(setClause).not.toMatch(new RegExp(`\\b${col} = \\$`));
    }
  });

  it("resolves {id} in the scrubbed email so it stays globally unique", () => {
    expect(params).toContain(`deleted-${USER}@deleted.invalid`);
  });

  it("resolves {now} to the reap timestamp (deleted_at / updated_at)", () => {
    const nowCount = params.filter((p) => p === NOW).length;
    expect(nowCount).toBe(2); // deleted_at + updated_at
  });

  it("preserves non-string scrub values (empty arrays, false, 0, null)", () => {
    expect(params).toContainEqual([]); // totp_backup_codes / dismissed_banner_keys
    expect(params).toContain(false); // totp_enabled / email_verified
    expect(params).toContain(0); // failed_login_attempts
    expect(params).toContain(null); // e.g. totp_secret
  });

  it("pins WHERE id + organization_id + status='pending_deletion' (idempotency gate)", () => {
    expect(sql).toMatch(/WHERE id = \$\d+ AND organization_id = \$\d+ AND status = 'pending_deletion'/);
    // the last two params are the user + org ids
    expect(params[params.length - 2]).toBe(USER);
    expect(params[params.length - 1]).toBe(ORG);
  });

  it("only mutates the users table", () => {
    expect(sql).toMatch(/^UPDATE users SET /);
  });
});

describe("claimedJobTypes — reap claimed only when enabled", () => {
  it("excludes account_deletion_reap when the flag is off", () => {
    expect(claimedJobTypes(false)).toEqual(["data_export_self", "data_export_org"]);
  });
  it("includes account_deletion_reap when the flag is on", () => {
    expect(claimedJobTypes(true)).toContain(ACCOUNT_DELETION_REAP_JOB_TYPE);
  });
});

describe("flag + constants", () => {
  it("reaper is OFF by default and only the literal 'true' enables it", () => {
    expect(accountDeletionReaperEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(accountDeletionReaperEnabled({ SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED: "1" } as any)).toBe(false);
    expect(accountDeletionReaperEnabled({ SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED: "true" } as any)).toBe(true);
  });
  it("30-day grace window", () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
  });
  it("reviewer-text + category-B sets match the settled decision-locks", () => {
    expect(REVIEWER_TEXT_TABLES).toEqual([
      "risk_treatments",
      "obligation_assessments",
      "vendor_reviews",
      "ai_governance_assessments",
      "dependency_assessments",
    ]);
    // D-2 (legal_consents) + D-3 (org_invites) are NOT deleted.
    expect(CATEGORY_B_DELETE_TABLES).not.toContain("legal_consents");
    expect(CATEGORY_B_DELETE_TABLES).not.toContain("org_invites");
    expect(CATEGORY_B_DELETE_TABLES).toContain("password_history");
  });
});
