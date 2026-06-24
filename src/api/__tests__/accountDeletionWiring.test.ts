/**
 * accountDeletionWiring.test.ts — source-asserts pinning the reaper's four
 * components and, crucially, the flag-gating that keeps the whole feature INERT
 * in production until SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED is set:
 *   producer (enqueuer) gated · consumer (worker claim) gated · request gated ·
 *   login blocks the lifecycle states.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const WORKER = read("../workers/dataRightsWorker.ts");
const ENQUEUER = read("../lib/accountDeletionEnqueuer.ts");
const ROUTE = read("../routes/accountDeletion.ts");
const AUTH = read("../routes/customerAuth.ts");
const SERVER = read("../server.ts");
const INDEX = read("../routes/index.ts");

describe("consumer — worker claims reap jobs only when enabled", () => {
  it("claimNextJob passes claimedJobTypes(accountDeletionReaperEnabled())", () => {
    expect(WORKER).toMatch(/claimedJobTypes\(accountDeletionReaperEnabled\(\)\)/);
  });
  it("processClaimedJob branches to processReapJob on the reap job type", () => {
    expect(WORKER).toMatch(/job\.job_type === ACCOUNT_DELETION_REAP_JOB_TYPE/);
    expect(WORKER).toMatch(/processReapJob\(job/);
  });
});

describe("producer — enqueuer is gated + de-duped + cross-org elevated", () => {
  it("returns 0 without touching the DB when the flag is off", () => {
    expect(ENQUEUER).toMatch(/if \(!accountDeletionReaperEnabled\(\)\) return 0;/);
  });
  it("de-dups against in-flight reap jobs (NOT EXISTS queued/processing)", () => {
    expect(ENQUEUER).toMatch(/NOT EXISTS/);
    expect(ENQUEUER).toMatch(/status IN \('queued', 'processing'\)/);
  });
  it("scans only users past their grace window on the elevated channel", () => {
    expect(ENQUEUER).toMatch(/status = 'pending_deletion'/);
    expect(ENQUEUER).toMatch(/deletion_scheduled_at <= now\(\)/);
    expect(ENQUEUER).toMatch(/pgElevated\.query/);
  });
});

describe("request endpoint — gated + self-only + grace window", () => {
  it("returns 404 when the reaper flag is off (no stranded users)", () => {
    expect(ROUTE).toMatch(/if \(!accountDeletionReaperEnabled\(\)\)[\s\S]{0,80}status\(404\)/);
  });
  it("targets the caller's own user id from the JWT (D-5 self-only)", () => {
    expect(ROUTE).toMatch(/jwtPayload\?\.sub/);
    // the UPDATE keys on id = $1 (= the caller) AND organization_id
    expect(ROUTE).toMatch(/WHERE id = \$1 AND organization_id = \$2 AND status = 'active'/);
  });
  it("stamps the 30-day reap time", () => {
    expect(ROUTE).toMatch(/deletion_scheduled_at = now\(\) \+ make_interval\(days => \$3::int\)/);
  });
  it("has a cancel route that reverts to active during the window", () => {
    expect(ROUTE).toMatch(/account\/deletion\/cancel/);
    expect(ROUTE).toMatch(/SET\s+status = 'active'[\s\S]{0,400}WHERE id = \$1 AND organization_id = \$2 AND status = 'pending_deletion'/);
  });
});

describe("login blocks the deletion lifecycle states", () => {
  it("selects status and rejects pending_deletion / deleted with 403", () => {
    expect(AUTH).toMatch(/status === "pending_deletion" \|\| user\.status === "deleted"/);
    expect(AUTH).toMatch(/account_pending_deletion/);
  });
});

describe("boot wiring", () => {
  it("server registers the enqueuer cron", () => {
    expect(SERVER).toMatch(/startAccountDeletionReaperEnqueuer\(\)/);
  });
  it("routes mount the account-deletion router", () => {
    expect(INDEX).toMatch(/accountDeletionRouter/);
  });
});
