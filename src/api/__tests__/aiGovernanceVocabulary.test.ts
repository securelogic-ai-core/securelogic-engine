/**
 * aiGovernanceVocabulary.test.ts — the validation vocabularies and the
 * migration CHECKs are two declarations of one rule set.
 *
 * aiSystemValidation.ts and 20261037/20261039 each state the closed
 * vocabularies (EU AI Act tier, human oversight, sensitive-data categories,
 * use-approval decisions). Two statements of one vocabulary is a duplication
 * with a cost, taken deliberately — the migration must run without the
 * application, the module must validate without the database — and this test
 * is the mechanism that makes drift fail CI instead of surfacing as a 400 and
 * a 23514 disagreeing about the same value. Same pattern as
 * requirementScopeTags.test.ts, for the same reason.
 *
 * It also pins the cross-domain reuse rule: human_oversight_level is the
 * vendor_engagements.ai_autonomy vocabulary, verbatim. If either side ever
 * changes alone, this fails.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EU_AI_ACT_TIERS,
  HUMAN_OVERSIGHT_LEVELS,
  SENSITIVE_DATA_CATEGORIES,
  AI_USE_APPROVAL_DECISIONS,
  MATERIAL_GOVERNANCE_FIELDS
} from "../lib/aiSystemValidation.js";

const MIGRATIONS = join(process.cwd(), "db", "migrations");
const enrichment = readFileSync(
  join(MIGRATIONS, "20261037_ai_system_governance_enrichment.sql"),
  "utf8"
);
const approvals = readFileSync(
  join(MIGRATIONS, "20261039_ai_use_approvals.sql"),
  "utf8"
);
const engagements = readFileSync(
  join(MIGRATIONS, "20260919_vendor_engagements.sql"),
  "utf8"
);

/** Every quoted literal inside the named CHECK constraint's IN (...) list. */
function checkList(sql: string, constraint: string): string[] {
  const at = sql.indexOf(constraint);
  expect(at, `constraint ${constraint} present`).toBeGreaterThan(-1);
  const inAt = sql.indexOf("IN", at);
  const close = sql.indexOf(")", sql.indexOf("(", inAt) + 1);
  const segment = sql.slice(inAt, close + 1);
  return [...segment.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("vocabularies mirror the migration CHECKs exactly", () => {
  it("eu_ai_act_tier", () => {
    expect(new Set(checkList(enrichment, "ai_systems_eu_ai_act_tier_check"))).toEqual(
      EU_AI_ACT_TIERS
    );
  });

  it("human_oversight_level", () => {
    expect(
      new Set(checkList(enrichment, "ai_systems_human_oversight_level_check"))
    ).toEqual(HUMAN_OVERSIGHT_LEVELS);
  });

  it("sensitive_data_categories", () => {
    const arrAt = enrichment.indexOf("ai_systems_sensitive_data_categories_check");
    const segment = enrichment.slice(arrAt, enrichment.indexOf("]::text[]", arrAt));
    const values = [...segment.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(values)).toEqual(SENSITIVE_DATA_CATEGORIES);
  });

  it("use-approval decisions", () => {
    const at = approvals.indexOf("decision               TEXT        NOT NULL CHECK");
    const segment = approvals.slice(at, approvals.indexOf("))", at));
    const values = [...segment.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(values)).toEqual(AI_USE_APPROVAL_DECISIONS);
  });
});

describe("cross-domain vocabulary reuse", () => {
  it("human_oversight_level IS vendor_engagements.ai_autonomy, verbatim", () => {
    const vendorVocab = checkList(engagements, "ai_autonomy");
    expect(new Set(vendorVocab)).toEqual(HUMAN_OVERSIGHT_LEVELS);
  });
});

describe("material-field set sanity", () => {
  it("every material field is a real ai_systems column the PATCH accepts", () => {
    // The set is consumed by string membership against PATCH body keys; a
    // typo'd entry would silently never match and the field would stop being
    // material. Pin the exact set.
    expect([...MATERIAL_GOVERNANCE_FIELDS].sort()).toEqual([
      "criticality",
      "deployment_status",
      "eu_ai_act_tier",
      "human_oversight_level",
      "sensitive_data_categories",
      "use_case"
    ]);
  });
});
