/**
 * tenantDataGovernance.test.ts — the E-1 invariants that can be proven without
 * a database. Each block names the invariant it holds; the ones needing real
 * Postgres (TDG-13 isolation, the WORM triggers, the SoD CHECK, the ledger
 * SET NULL) live in test/isolation/tenantDataGovernance.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  GOVERNED_DATA_CLASSES,
  getDataClass,
  listDataClasses,
  sweepOrder,
  type GovernedDataClass
} from "../lib/governance/dataClasses.js";
import {
  resolveEffectivePolicy,
  validateRetentionDays,
  validateAgainstDependencies,
  validatePolicyWrite,
  type RetentionPolicyVersion,
  type EffectivePolicy
} from "../lib/governance/retentionPolicy.js";
import { canPlaceHold, canReleaseHold, statusForHoldReason } from "../lib/governance/legalHoldAuthority.js";
import { holdCovering, isHeld, type ActiveHold } from "../lib/governance/holdPredicate.js";
import {
  tenantDataGovernanceEnabled,
  tdgEffectiveFrom,
  deletionsPermitted,
  retentionCutoff,
  activationBlockers,
  TDG_GRACE_DAYS
} from "../lib/governance/tdgPolicy.js";
import { TABLE_CLASSIFICATION } from "../lib/dataClassification.js";
import { CATEGORY_B_DELETE_TABLES } from "../lib/accountDeletionReaperPolicy.js";
import {
  LIFECYCLE_EVENTS,
  getLifecycleEvent,
  eventsOverriddenByLegalHold
} from "../lib/governance/lifecycleEvents.js";

const ASK = getDataClass("ask_conversation") as GovernedDataClass;
const LEDGER = getDataClass("ask_tool_invocation") as GovernedDataClass;

function version(over: Partial<RetentionPolicyVersion> = {}): RetentionPolicyVersion {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "org-a",
    dataClass: "ask_conversation",
    version: 1,
    retentionDays: 90,
    cleared: false,
    source: "tenant",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    ...over
  };
}

/* ───────────────────────────── TDG-2 / TDG-3 ─────────────────────────────── */

describe("TDG-3: the Ask default is 365 days, declared in the registry", () => {
  it("is 365 and is not written in a route, worker or SQL literal", () => {
    expect(ASK.defaultDays).toBe(365);
    // The number must come from the registry — grep the shipped modules for a
    // hard-coded 365 that would let the two drift.
    for (const file of ["retentionService.ts", "classHandlers.ts", "governanceStore.ts"]) {
      const src = readFileSync(
        resolve(process.cwd(), "src/api/lib/governance", file),
        "utf8"
      );
      expect(src).not.toMatch(/\b365\b/);
    }
  });
});

describe("TDG-2: absence of a policy row means the platform default", () => {
  it("resolves the class default with source platform_default", () => {
    const p = resolveEffectivePolicy(ASK, []);
    expect(p.retentionDays).toBe(365);
    expect(p.source).toBe("platform_default");
    expect(p.policyVersionId).toBeNull();
  });

  it("a cleared version reverts to the default without deleting history", () => {
    const p = resolveEffectivePolicy(ASK, [
      version({ version: 1, retentionDays: 90 }),
      version({ version: 2, retentionDays: null, cleared: true })
    ]);
    expect(p.retentionDays).toBe(365);
    expect(p.source).toBe("platform_default");
  });
});

/* ─────────────────────────────── TDG-1 / TDG-8 ───────────────────────────── */

describe("TDG-1 / TDG-8: the org's newest effective version wins, and it is identified", () => {
  it("picks the highest version regardless of input order", () => {
    const p = resolveEffectivePolicy(ASK, [
      version({ version: 2, retentionDays: 60, id: "v2" }),
      version({ version: 1, retentionDays: 90, id: "v1" }),
      version({ version: 3, retentionDays: 30, id: "v3" })
    ]);
    expect(p.retentionDays).toBe(30);
    expect(p.policyVersionId).toBe("v3");
    expect(p.version).toBe(3);
  });

  it("ignores versions that have not taken effect yet", () => {
    const p = resolveEffectivePolicy(
      ASK,
      [
        version({ version: 1, retentionDays: 90, id: "v1" }),
        version({ version: 2, retentionDays: 30, id: "v2", effectiveFrom: new Date("2030-01-01T00:00:00Z") })
      ],
      new Date("2026-06-01T00:00:00Z")
    );
    expect(p.retentionDays).toBe(90);
    expect(p.policyVersionId).toBe("v1");
  });

  it("ignores rows belonging to another class even if the caller's SQL leaks them", () => {
    const p = resolveEffectivePolicy(ASK, [
      version({ version: 9, retentionDays: 1, dataClass: "some_other_class" })
    ]);
    expect(p.source).toBe("platform_default");
  });
});

/* ───────────────────────────────── TDG-4 ─────────────────────────────────── */

describe("TDG-4: supported values are explicit, and rejected rather than clamped", () => {
  const cases: Array<[unknown, boolean]> = [
    [30, true],
    [365, true],
    [180, true],
    [29, false],
    [366, false],
    [0, false],
    [-1, false],
    [36.5, false],
    ["365", false],
    [null, false],
    [undefined, false],
    [Number.NaN, false]
  ];

  for (const [input, ok] of cases) {
    it(`${JSON.stringify(input)} → ${ok ? "accepted" : "rejected"}`, () => {
      expect(validateRetentionDays(ASK, input).ok).toBe(ok);
    });
  }

  it("never returns a coerced value — the API is a verdict, not a transform", () => {
    const result = validateRetentionDays(ASK, 10_000) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(Object.keys(result)).not.toContain("value");
    expect(Object.keys(result)).not.toContain("clamped");
  });

  it("refuses any tenant write to a non-configurable class", () => {
    const r = validateRetentionDays(LEDGER, 365);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("class_not_configurable");
  });
});

/* ───────────────────────────────── TDG-5 ─────────────────────────────────── */

describe("TDG-5: content can never outlive the provenance that substantiates it", () => {
  const ledgerAt = (days: number): EffectivePolicy => ({
    dataClass: "ask_tool_invocation",
    retentionDays: days,
    source: "platform_default",
    policyVersionId: null,
    version: null,
    effectiveFrom: null
  });

  it("accepts a retention at or below the ledger's", () => {
    expect(validateAgainstDependencies(ASK, 365, () => ledgerAt(365)).ok).toBe(true);
    expect(validateAgainstDependencies(ASK, 90, () => ledgerAt(365)).ok).toBe(true);
  });

  it("rejects a retention above the ledger's", () => {
    const r = validateAgainstDependencies(ASK, 400, () => ledgerAt(365));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("exceeds_dependency");
  });

  it("refuses when a dependency cannot be resolved — 'cannot be shown' is a no", () => {
    const r = validateAgainstDependencies(ASK, 30, () => null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("exceeds_dependency");
  });

  it("the class bounds alone already make the breach unreachable", () => {
    // maxDays is capped at the ledger period, so even a caller that skipped the
    // dependency check could not set content beyond its evidence.
    expect(ASK.maxDays).toBeLessThanOrEqual(LEDGER.defaultDays);
  });

  it("validatePolicyWrite reports the bound failure before the dependency one", () => {
    const r = validatePolicyWrite(ASK, 900, () => ledgerAt(365));
    expect(r.code).toBe("out_of_range");
  });
});

/* ───────────────────────────────── TDG-6 ─────────────────────────────────── */

describe("TDG-6: hold scopes cover exactly what they claim to", () => {
  const target = { dataClass: "ask_conversation", objectId: "obj-1", ownerUserId: "user-1" };
  const hold = (over: Partial<ActiveHold>): ActiveHold => ({
    id: "h1",
    scopeType: "organization",
    dataClass: null,
    subjectUserId: null,
    objectId: null,
    ...over
  });

  it("an organization hold covers everything", () => {
    expect(holdCovering([hold({ scopeType: "organization" })], target)).toBe("h1");
  });

  it("a data_class hold covers only its class", () => {
    expect(isHeld([hold({ scopeType: "data_class", dataClass: "ask_conversation" })], target)).toBe(true);
    expect(isHeld([hold({ scopeType: "data_class", dataClass: "something_else" })], target)).toBe(false);
  });

  it("a subject hold covers only that subject, and never widens when the owner is null", () => {
    expect(isHeld([hold({ scopeType: "subject_user", subjectUserId: "user-1" })], target)).toBe(true);
    expect(isHeld([hold({ scopeType: "subject_user", subjectUserId: "user-2" })], target)).toBe(false);
    expect(
      isHeld([hold({ scopeType: "subject_user", subjectUserId: "user-1" })], { ...target, ownerUserId: null })
    ).toBe(false);
  });

  it("an object hold covers one object of one class", () => {
    const h = hold({ scopeType: "object", dataClass: "ask_conversation", objectId: "obj-1" });
    expect(isHeld([h], target)).toBe(true);
    expect(isHeld([h], { ...target, objectId: "obj-2" })).toBe(false);
  });

  it("no holds means not held", () => {
    expect(holdCovering([], target)).toBeNull();
  });
});

/* ───────────────────────────────── TDG-7 ─────────────────────────────────── */

describe("TDG-7: hold authority and separation of duties", () => {
  const admin = { actorUserId: "u-1", actorRole: "admin", reason: "Matter 2026-14" };

  it("an admin with a reason may place a hold", () => {
    expect(canPlaceHold(admin).allowed).toBe(true);
  });

  it("an API-key caller may not — a hold is an attributable legal act", () => {
    const d = canPlaceHold({ ...admin, actorUserId: null });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("hold_requires_user");
  });

  it("a non-admin may not", () => {
    expect(canPlaceHold({ ...admin, actorRole: "analyst" }).reason).toBe("admin_role_required");
    expect(canPlaceHold({ ...admin, actorRole: "viewer" }).reason).toBe("admin_role_required");
  });

  it("a reason is mandatory, and whitespace is not a reason", () => {
    expect(canPlaceHold({ ...admin, reason: "" }).reason).toBe("reason_required");
    expect(canPlaceHold({ ...admin, reason: "   " }).reason).toBe("reason_required");
    expect(canPlaceHold({ ...admin, reason: null }).reason).toBe("reason_required");
  });

  it("the placer cannot release their own hold", () => {
    const d = canReleaseHold({ ...admin, placedByUserId: "u-1" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("sod_violation");
    expect(statusForHoldReason(d.reason!)).toBe(409);
  });

  it("a different admin can", () => {
    expect(canReleaseHold({ ...admin, actorUserId: "u-2", placedByUserId: "u-1" }).allowed).toBe(true);
  });

  it("a scrubbed placer falls back to admin authority, not to 'anyone'", () => {
    expect(canReleaseHold({ ...admin, placedByUserId: null }).allowed).toBe(true);
    expect(canReleaseHold({ ...admin, actorRole: "analyst", placedByUserId: null }).allowed).toBe(false);
  });
});

/* ───────────────────────── TDG-9 activation + determinism ────────────────── */

describe("TDG-9: the activation gates, and the grandfather rule", () => {
  const on = { SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "true" } as NodeJS.ProcessEnv;

  it("the flag is off unless it is exactly 'true'", () => {
    expect(tenantDataGovernanceEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(tenantDataGovernanceEnabled({ SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(tenantDataGovernanceEnabled({ SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(tenantDataGovernanceEnabled(on)).toBe(true);
  });

  it("an unset or unparseable effective-from is null — a typo must not mean 'now'", () => {
    expect(tdgEffectiveFrom({} as NodeJS.ProcessEnv)).toBeNull();
    expect(tdgEffectiveFrom({ SECURELOGIC_TDG_EFFECTIVE_FROM: "" } as NodeJS.ProcessEnv)).toBeNull();
    expect(tdgEffectiveFrom({ SECURELOGIC_TDG_EFFECTIVE_FROM: "yesterday" } as NodeJS.ProcessEnv)).toBeNull();
    expect(
      tdgEffectiveFrom({ SECURELOGIC_TDG_EFFECTIVE_FROM: "2026-09-01T00:00:00Z" } as NodeJS.ProcessEnv)?.toISOString()
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  it("no effective-from means no deletions, ever", () => {
    expect(deletionsPermitted(new Date("2030-01-01T00:00:00Z"), null)).toBe(false);
  });

  it("deletions wait out the full grace window", () => {
    const from = new Date("2026-09-01T00:00:00Z");
    const dayAfter = new Date(from.getTime() + (TDG_GRACE_DAYS - 1) * 86_400_000);
    const exactly = new Date(from.getTime() + TDG_GRACE_DAYS * 86_400_000);
    expect(deletionsPermitted(from, from)).toBe(false);
    expect(deletionsPermitted(dayAfter, from)).toBe(false);
    expect(deletionsPermitted(exactly, from)).toBe(true);
  });

  it("blockers name every closed gate", () => {
    expect(activationBlockers({} as NodeJS.ProcessEnv, new Date())).toEqual([
      "flag_disabled",
      "effective_from_unset"
    ]);
    expect(
      activationBlockers(
        { ...on, SECURELOGIC_TDG_EFFECTIVE_FROM: "2026-09-01T00:00:00Z" } as NodeJS.ProcessEnv,
        new Date("2026-09-05T00:00:00Z")
      )
    ).toEqual(["grace_window_open"]);
    expect(
      activationBlockers(
        { ...on, SECURELOGIC_TDG_EFFECTIVE_FROM: "2026-09-01T00:00:00Z" } as NodeJS.ProcessEnv,
        new Date("2027-01-01T00:00:00Z")
      )
    ).toEqual([]);
  });

  it("the cutoff is a pure function of its inputs", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    expect(retentionCutoff(now, 365).toISOString()).toBe(retentionCutoff(now, 365).toISOString());
    expect(retentionCutoff(now, 365).toISOString()).toBe("2025-08-16T12:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });
});

/* ──────────────────────────────── TDG-11 ─────────────────────────────────── */

describe("TDG-11: the registry cannot contradict dataClassification.ts", () => {
  it("every governed table is classified, at the category the registry claims", () => {
    for (const c of listDataClasses()) {
      for (const table of c.tables) {
        const classification = (TABLE_CLASSIFICATION as Record<string, { category: string } | undefined>)[table];
        expect(classification, `${table} is governed but unclassified`).toBeDefined();
        expect(classification!.category, `${table} category drift`).toBe(c.classificationCategory);
      }
    }
  });

  it("the classification no longer promises an erasure the reaper does not perform", () => {
    const src = readFileSync(resolve(process.cwd(), "src/api/lib/dataClassification.ts"), "utf8");
    const line = src.split("\n").find((l) => l.includes("ask_conversations: {"))!;
    expect(line).not.toMatch(/included in GDPR export and erasure/);
    expect(line).toMatch(/NOT deleted by the Art\.17 self-deletion reaper/);
  });
});

/* ──────────────────────────────── TDG-14 ─────────────────────────────────── */

describe("TDG-14: audit payloads record governance, never content", () => {
  it("no payload interface can express conversation content", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/api/lib/governance/governanceAudit.ts"),
      "utf8"
    );
    // The payload block is everything between the shapes banner and the input type.
    const start = src.indexOf("/* ── Payload shapes");
    const end = src.indexOf("export interface GovernanceEventInput");
    const payloads = src.slice(start, end);
    for (const forbidden of ["content", "title", "claims", "toolPayloads", "answer", "question", "messageText"]) {
      expect(payloads, `payload shapes must not carry '${forbidden}'`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b\\s*[?:]`)
      );
    }
    // And no escape hatch that could smuggle it.
    expect(payloads).not.toMatch(/Record<string,\s*unknown>/);
  });
});

/* ──────────────────────────────── TDG-15 ─────────────────────────────────── */

describe("TDG-15: the model extends to new classes without redesign", () => {
  it("a hypothetical class resolves, validates and orders with zero code changes", () => {
    const jobsClass: GovernedDataClass = {
      key: "jobs",
      label: "Background jobs",
      tables: ["jobs"],
      ageColumn: "completed_at",
      ageFallbackColumn: "created_at",
      defaultDays: 90,
      minDays: 30,
      maxDays: 400,
      tenantConfigurable: true,
      dependsOn: [],
      subjectColumns: [],
      erasureDisposition: "system_ledger",
      classificationCategory: "E"
    };

    expect(resolveEffectivePolicy(jobsClass, []).retentionDays).toBe(90);
    expect(validateRetentionDays(jobsClass, 400).ok).toBe(true);
    expect(validateRetentionDays(jobsClass, 401).ok).toBe(false);
    expect(sweepOrder([jobsClass]).map((c) => c.key)).toEqual(["jobs"]);
  });

  it("sweep order puts a dependent class before the class it depends on", () => {
    const order = sweepOrder().map((c) => c.key);
    expect(order.indexOf("ask_conversation")).toBeLessThan(order.indexOf("ask_tool_invocation"));
    expect(order).toHaveLength(GOVERNED_DATA_CLASSES.length);
  });

  it("an unregistered key resolves to nothing rather than a default", () => {
    expect(getDataClass("not_a_class")).toBeNull();
  });
});

/* ───────────────── The operator ruling of 2026-08-16, pinned ─────────────── */

describe("RULING: an Ask conversation is an organization-governed record", () => {
  it("does not die with its author — the class says so", () => {
    expect(ASK.erasureDisposition).toBe("org_content");
  });

  it("account deletion PRESERVES rather than deletes", () => {
    const event = getLifecycleEvent("account_deletion");
    expect(event.disposition).toBe("preserves");
    expect(event.deletionTrigger).toBeNull();
  });

  it("the reaper's explicit delete list does not contain the Ask tables", () => {
    // The reaper tombstones the users row, so CASCADE never fires; the only way
    // Ask content could die with a user is by being listed here. It is not.
    for (const table of ASK.tables) {
      expect(CATEGORY_B_DELETE_TABLES).not.toContain(table);
    }
  });

  it("the schema cannot contradict the ruling: the owner FK is SET NULL, not CASCADE", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "db/migrations/20261016_ask_conversations_survive_user_deletion.sql"),
      "utf8"
    );
    expect(migration).toMatch(/REFERENCES users\(id\) ON DELETE SET NULL/);
    // And the original CASCADE is gone from the effective schema — the later
    // migration drops the constraint by name before recreating it.
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS ask_conversations_user_id_fkey/);
  });

  it("preserved conversations still expire under the org's retention policy", () => {
    // "Preserved" means preserved as a GOVERNED record, not preserved forever.
    expect(ASK.tenantConfigurable).toBe(true);
    expect(resolveEffectivePolicy(ASK, []).retentionDays).toBe(365);
  });
});

describe("the five lifecycle events are distinguished, not collapsed", () => {
  it("declares every event the ruling names", () => {
    const keys = LIFECYCLE_EVENTS.map((e) => e.key);
    for (const required of [
      "account_deletion",
      "owner_conversation_deletion",
      "organization_erasure",
      "retention_expiration",
      "legal_hold"
    ]) {
      expect(keys).toContain(required);
    }
  });

  it("gives each event a distinct disposition or trigger — none is an alias of another", () => {
    const signatures = LIFECYCLE_EVENTS.map((e) => `${e.disposition}:${e.deletionTrigger ?? "none"}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("a legal hold outranks exactly the three deletion events, and nothing else", () => {
    expect(eventsOverriddenByLegalHold().map((e) => e.key).sort()).toEqual([
      "administrator_deletion",
      "organization_erasure",
      "owner_conversation_deletion",
      "retention_expiration"
    ].sort());
    // It does not outrank itself, and it does not gate account deletion today.
    expect(getLifecycleEvent("legal_hold").overriddenByLegalHold).toBe(false);
    expect(getLifecycleEvent("account_deletion").overriddenByLegalHold).toBe(false);
  });

  it("organization erasure is declared UNBUILT rather than quietly assumed", () => {
    const org = getLifecycleEvent("organization_erasure");
    expect(org.disposition).toBe("deletes_all");
    expect(org.implementedBy).toMatch(/NOT BUILT/);
    expect(org.implementedBy).toMatch(/ADR-0005/);
  });

  it("every deletion trigger the audit ledger can record maps to a declared event", () => {
    const triggers = LIFECYCLE_EVENTS.map((e) => e.deletionTrigger).filter(Boolean);
    expect(triggers.sort()).toEqual(["administrator", "owner_request", "retention_expiry"]);
  });
});
