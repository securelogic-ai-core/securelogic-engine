/**
 * assessmentSpec.ts — the AssessmentTypeSpec registry (EAR P10, EAR-AD-5).
 *
 * Design authority: docs/architecture/enterprise-asset-registry/
 * P10-ASSESSMENT-SERVICE-MEMO.md. The ASSET_TYPE_SPECS pattern
 * (assetRegistry.ts) applied to assessments: ONE code-level capability table
 * describing every assessment lifecycle on the platform — the single source
 * of truth for status vocabularies, terminal sets, finding-trigger sets, and
 * transition graphs.
 *
 * The seven legacy stacks' validation modules DELEGATE their status-machine
 * data to their spec row (pure-data delegation, behavior-identical — the
 * lockstep test asserts equality with the historical literals). Their
 * bespoke create-validators and route transactions are intentionally NOT
 * collapsed here (EAR-AD-7: staged collapse, one stack per PR, later epic).
 *
 * Two lifecycle patterns exist and the legacy NAMES LIE about which is which
 * (vendor_assessments is immutable-at-POST but ai_governance_assessments is
 * the mutable workflow), so the pattern is a spec FIELD:
 *   - immutableAtPost=false — mutable status-machine; finding on FIRST
 *     transition into a findingStatuses member (5 stacks + the new generic
 *     asset path).
 *   - immutableAtPost=true  — point-in-time record, no PATCH; finding always
 *     created at POST (vendor_assessments, governance_reviews).
 *
 * `transitions`/`terminalStatuses` are null where the legacy stack never had
 * them (control/ai_governance/dependency allow any valid-status change —
 * preserved verbatim; tightening them would change behavior).
 */

export type AssessmentTypeKey =
  | "control"
  | "obligation"
  | "ai_governance"
  | "dependency"
  | "vendor_review"
  | "vendor_assessment"
  | "governance_review"
  | "asset";

export interface AssessmentTypeSpec {
  key: AssessmentTypeKey;
  /** Physical assessment table. */
  table: string;
  /** Backing table (or view) the subject id resolves against. */
  subjectKind: string;
  /** Full status vocabulary (empty for governance_reviews — outcome-based). */
  statuses: ReadonlySet<string>;
  /** No-exit statuses; null = stack has no terminal guard (historical). */
  terminalStatuses: ReadonlySet<string> | null;
  /** Statuses that trigger finding creation on FIRST transition in (or, for
   * immutableAtPost stacks, the always-at-POST marker set). */
  findingStatuses: ReadonlySet<string>;
  /** Legal transition graph; null = any valid-status change (historical). */
  transitions: Readonly<Record<string, readonly string[]>> | null;
  /** findings.source_type this stack emits. */
  findingSourceType: string;
  /** Point-in-time record (no PATCH, finding at POST). */
  immutableAtPost: boolean;
}

export const ASSESSMENT_TYPE_SPECS: Readonly<
  Record<AssessmentTypeKey, AssessmentTypeSpec>
> = {
  control: {
    key: "control",
    table: "control_assessments",
    subjectKind: "controls",
    statuses: new Set(["not_started", "in_progress", "passed", "failed", "remediation_required"]),
    terminalStatuses: null,
    findingStatuses: new Set(["failed", "remediation_required"]),
    transitions: null,
    findingSourceType: "control_test",
    immutableAtPost: false
  },
  obligation: {
    key: "obligation",
    table: "obligation_assessments",
    subjectKind: "obligations",
    statuses: new Set(["not_started", "in_progress", "compliant", "non_compliant", "partially_compliant"]),
    terminalStatuses: new Set(["compliant", "non_compliant", "partially_compliant"]),
    findingStatuses: new Set(["non_compliant", "partially_compliant"]),
    transitions: {
      not_started: ["in_progress"],
      in_progress: ["compliant", "non_compliant", "partially_compliant"],
      compliant: [],
      non_compliant: [],
      partially_compliant: []
    },
    findingSourceType: "obligation_review",
    immutableAtPost: false
  },
  ai_governance: {
    key: "ai_governance",
    table: "ai_governance_assessments",
    subjectKind: "ai_systems",
    statuses: new Set(["not_started", "in_progress", "compliant", "non_compliant", "partially_compliant"]),
    terminalStatuses: null,
    findingStatuses: new Set(["non_compliant", "partially_compliant"]),
    transitions: null,
    findingSourceType: "ai_governance_review",
    immutableAtPost: false
  },
  dependency: {
    key: "dependency",
    table: "dependency_assessments",
    subjectKind: "dependencies",
    statuses: new Set(["not_started", "in_progress", "acceptable", "flagged", "needs_remediation"]),
    terminalStatuses: null,
    findingStatuses: new Set(["flagged", "needs_remediation"]),
    transitions: null,
    findingSourceType: "dependency_review",
    immutableAtPost: false
  },
  vendor_review: {
    key: "vendor_review",
    table: "vendor_reviews",
    subjectKind: "vendors",
    statuses: new Set(["not_started", "in_progress", "satisfactory", "concerns_identified", "critical_issues"]),
    terminalStatuses: new Set(["satisfactory", "concerns_identified", "critical_issues"]),
    findingStatuses: new Set(["concerns_identified", "critical_issues"]),
    transitions: {
      not_started: ["in_progress"],
      in_progress: ["satisfactory", "concerns_identified", "critical_issues"],
      satisfactory: [],
      concerns_identified: [],
      critical_issues: []
    },
    findingSourceType: "vendor_cycle_review",
    immutableAtPost: false
  },
  vendor_assessment: {
    key: "vendor_assessment",
    table: "vendor_assessments",
    subjectKind: "vendors",
    statuses: new Set(["completed"]),
    terminalStatuses: new Set(["completed"]),
    findingStatuses: new Set(["completed"]),
    transitions: null,
    findingSourceType: "vendor_review",
    immutableAtPost: true
  },
  governance_review: {
    key: "governance_review",
    table: "governance_reviews",
    subjectKind: "ai_systems",
    // outcome-based (review_type + outcome), no status column.
    statuses: new Set<string>(),
    terminalStatuses: null,
    findingStatuses: new Set<string>(),
    transitions: null,
    findingSourceType: "ai_review",
    immutableAtPost: true
  },
  /** EAR P10 — the generic path: subject is ANY registry asset (AssetRef). */
  asset: {
    key: "asset",
    table: "asset_assessments",
    subjectKind: "asset_registry_v",
    statuses: new Set(["not_started", "in_progress", "satisfactory", "deficient", "remediation_required"]),
    terminalStatuses: new Set(["satisfactory", "deficient", "remediation_required"]),
    findingStatuses: new Set(["deficient", "remediation_required"]),
    transitions: {
      not_started: ["in_progress"],
      in_progress: ["satisfactory", "deficient", "remediation_required"],
      satisfactory: [],
      deficient: [],
      remediation_required: []
    },
    findingSourceType: "asset_assessment",
    immutableAtPost: false
  }
} as const;

/**
 * Spec-driven transition legality. A null transition graph preserves the
 * historical free-transition behavior (any valid status → any valid status,
 * self-transitions included — exactly what those stacks accept today).
 */
export function specTransitionAllowed(
  spec: AssessmentTypeSpec,
  from: string,
  to: string
): boolean {
  if (spec.transitions) {
    return (spec.transitions[from] ?? []).includes(to);
  }
  return spec.statuses.has(from) && spec.statuses.has(to);
}
