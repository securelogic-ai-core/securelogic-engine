/**
 * Typed fixtures. They are the REAL exported types, so a fixture that drifts from the
 * wire contract fails typecheck rather than quietly testing a shape the engine stopped
 * sending.
 */
import type {
  Finding,
  FindingsResponse,
  FindingsSummary,
  MeResponse,
} from "@/lib/api";

export function aFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f-1",
    organization_id: "org-1",
    assessment_id: null,
    source_type: "manual",
    source_id: null,
    title: "Unencrypted backups in eu-west-1",
    severity: "High",
    description: "Backups are written without server-side encryption.",
    recommendation: "Enable SSE-KMS on the backup bucket.",
    framework_control_id: null,
    domain: "Cyber",
    priority: "planned",
    likelihood: null,
    confidence: null,
    time_sensitivity: null,
    scoring_rationale: null,
    status: "open",
    owner_user_id: null,
    due_date: null,
    action_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aFindingsResponse(
  findings: Finding[],
  overrides: Partial<FindingsResponse> = {}
): FindingsResponse {
  return {
    count: findings.length,
    limit: 100,
    total: findings.length,
    organizationId: "org-1",
    nextCursor: null,
    findings,
    ...overrides,
  };
}

export function aFindingsSummary(
  overrides: Partial<FindingsSummary> = {}
): FindingsSummary {
  return {
    open_count: 2,
    in_progress_open: 1,
    active_total: 3,
    critical_high_active: 1,
    critical_open: 1,
    high_open: 1,
    medium_open: 0,
    low_open: 0,
    closed_count: 4,
    immediate_priority: 0,
    vendor_sourced: 0,
    signal_sourced: 0,
    ...overrides,
  };
}

export function aMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    entitlementLevel: "platform",
    ...overrides,
  } as MeResponse;
}
