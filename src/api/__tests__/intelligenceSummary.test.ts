import { describe, it, expect, vi } from "vitest";

// vi.mock is hoisted before all imports by vitest's transform.
// This prevents postgres.ts from evaluating (it throws if DATABASE_URL is unset),
// which allows the route file to be imported without a live database connection.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import {
  buildLeadershipSummary,
  type TopRiskRow,
  type AffectedEntityRow,
  type HighCriticalFindingRow,
  type TreatmentSummaryRow,
  type RecentSignalRow,
  type PostureSnapshotRow
} from "../routes/intelligence.js";

// ---------------------------------------------------------------------------
// Seed data — representative rows that match the exact DB column shapes
// ---------------------------------------------------------------------------

const topRiskRows: TopRiskRow[] = [
  {
    id: "risk-1",
    title: "Unpatched critical CVE in payment gateway",
    domain: "Vendor Risk",
    risk_rating: "Critical",
    status: "open",
    likelihood: "High",
    owner: "alice@example.com",
    due_date: "2026-05-15"
  },
  {
    id: "risk-2",
    title: "AI model training data not audited",
    domain: "AI Governance",
    risk_rating: "High",
    status: "open",
    likelihood: "Medium",
    owner: null,
    due_date: null
  }
];

const affectedEntityRows: AffectedEntityRow[] = [
  {
    entity_id: "vendor-abc",
    entity_name: "Acme Payment Gateway",
    entity_type: "vendor",
    open_finding_count: "3",
    max_severity: "Critical"
  },
  {
    entity_id: "ai-xyz",
    entity_name: "Customer Churn Predictor",
    entity_type: "ai_system",
    open_finding_count: "1",
    max_severity: "High"
  },
  {
    entity_id: "dep-001",
    entity_name: "openssl",
    entity_type: "dependency",
    open_finding_count: "2",
    max_severity: "High"
  }
];

const highCriticalFindingRows: HighCriticalFindingRow[] = [
  {
    id: "finding-1",
    title: "CVE-2024-12345 affects vendor: Acme Payment Gateway",
    severity: "Critical",
    domain: "Vendor Risk",
    priority: "immediate",
    source_type: "cyber_signal",
    created_at: "2026-04-10T10:00:00Z"
  },
  {
    id: "finding-2",
    title: "AI Governance: Customer Churn Predictor — High severity",
    severity: "High",
    domain: "AI Governance",
    priority: "near_term",
    source_type: "ai_review",
    created_at: "2026-04-08T09:00:00Z"
  }
];

const treatmentSummaryRow: TreatmentSummaryRow = {
  in_progress_count: "4",
  overdue_count: "2",
  total_active_count: "7"
};

const recentSignalRows: RecentSignalRow[] = [
  {
    id: "sig-1",
    source: "cisa",
    signal_type: "cve",
    severity: "Critical",
    normalized_summary: "Critical vulnerability in Acme Payment Gateway SSL library",
    affected_vendor: "Acme Payment Gateway",
    affected_cve: "CVE-2024-12345",
    ingestion_timestamp: "2026-04-13T14:30:00Z",
    linked_finding_id: "finding-1",
    finding_title: "CVE-2024-12345 affects vendor: Acme Payment Gateway",
    finding_severity: "Critical",
    finding_domain: "Vendor Risk"
  },
  {
    id: "sig-2",
    source: "nvd",
    signal_type: "advisory",
    severity: "High",
    normalized_summary: "Security advisory for cloud storage misconfiguration",
    affected_vendor: null,
    affected_cve: null,
    ingestion_timestamp: "2026-04-11T08:00:00Z",
    linked_finding_id: null,
    finding_title: null,
    finding_severity: null,
    finding_domain: null
  }
];

const currentSnapshotRow: PostureSnapshotRow = {
  id: "snap-current",
  snapshot_date: "2026-04-14",
  overall_score: 62,
  overall_severity: "High",
  open_finding_count: 8
};

const previousSnapshotRow: PostureSnapshotRow = {
  id: "snap-previous",
  snapshot_date: "2026-04-13",
  overall_score: 55,
  overall_severity: "High",
  open_finding_count: 10
};

// ---------------------------------------------------------------------------
// top_risks
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — top_risks", () => {
  it("includes all seeded risk rows", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks.length).toBe(2);
  });

  it("maps top risk id", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.id).toBe("risk-1");
  });

  it("maps top risk title", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.title).toBe("Unpatched critical CVE in payment gateway");
  });

  it("maps top risk domain", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.domain).toBe("Vendor Risk");
  });

  it("maps top risk risk_rating", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.risk_rating).toBe("Critical");
  });

  it("maps top risk owner when present", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.owner).toBe("alice@example.com");
  });

  it("maps null owner correctly", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[1]!.owner).toBeNull();
  });

  it("maps due_date when present", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[0]!.due_date).toBe("2026-05-15");
  });

  it("maps null due_date correctly", () => {
    const { top_risks } = buildLeadershipSummary(
      topRiskRows, [], [], null, [], null, null
    );
    expect(top_risks[1]!.due_date).toBeNull();
  });

  it("returns empty array when no risks", () => {
    const { top_risks } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(top_risks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// affected_entities
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — affected_entities", () => {
  it("includes all seeded entity rows", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities.length).toBe(3);
  });

  it("maps entity_id", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[0]!.entity_id).toBe("vendor-abc");
  });

  it("maps entity_name", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[0]!.entity_name).toBe("Acme Payment Gateway");
  });

  it("maps entity_type", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[0]!.entity_type).toBe("vendor");
  });

  it("parses open_finding_count as number", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[0]!.open_finding_count).toBe(3);
  });

  it("open_finding_count is type number not string", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(typeof affected_entities[0]!.open_finding_count).toBe("number");
  });

  it("maps max_severity", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[0]!.max_severity).toBe("Critical");
  });

  it("maps ai_system entity_type correctly", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[1]!.entity_type).toBe("ai_system");
  });

  it("maps dependency entity_type correctly", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], affectedEntityRows, [], null, [], null, null
    );
    expect(affected_entities[2]!.entity_type).toBe("dependency");
  });

  it("returns empty array when no entities", () => {
    const { affected_entities } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(affected_entities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// high_critical_findings
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — high_critical_findings", () => {
  it("includes all seeded finding rows", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings.length).toBe(2);
  });

  it("maps finding id", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.id).toBe("finding-1");
  });

  it("maps finding title", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.title).toBe(
      "CVE-2024-12345 affects vendor: Acme Payment Gateway"
    );
  });

  it("maps severity correctly", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.severity).toBe("Critical");
  });

  it("maps domain when present", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.domain).toBe("Vendor Risk");
  });

  it("maps priority when present", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.priority).toBe("immediate");
  });

  it("maps source_type", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], highCriticalFindingRows, null, [], null, null
    );
    expect(high_critical_findings[0]!.source_type).toBe("cyber_signal");
  });

  it("maps null domain as null", () => {
    const rowWithNullDomain: HighCriticalFindingRow = {
      id: "f-null",
      title: "Manual finding",
      severity: "High",
      domain: null,
      priority: null,
      source_type: "manual",
      created_at: "2026-04-09T00:00:00Z"
    };
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], [rowWithNullDomain], null, [], null, null
    );
    expect(high_critical_findings[0]!.domain).toBeNull();
    expect(high_critical_findings[0]!.priority).toBeNull();
  });

  it("returns empty array when no findings", () => {
    const { high_critical_findings } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(high_critical_findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// treatment_status
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — treatment_status", () => {
  it("parses in_progress_count as number", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], treatmentSummaryRow, [], null, null
    );
    expect(treatment_status.in_progress_count).toBe(4);
  });

  it("parses overdue_count as number", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], treatmentSummaryRow, [], null, null
    );
    expect(treatment_status.overdue_count).toBe(2);
  });

  it("parses total_active_count as number", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], treatmentSummaryRow, [], null, null
    );
    expect(treatment_status.total_active_count).toBe(7);
  });

  it("in_progress_count is type number not string", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], treatmentSummaryRow, [], null, null
    );
    expect(typeof treatment_status.in_progress_count).toBe("number");
  });

  it("defaults all counts to 0 when row is null", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(treatment_status.in_progress_count).toBe(0);
    expect(treatment_status.overdue_count).toBe(0);
    expect(treatment_status.total_active_count).toBe(0);
  });

  it("output has exactly 3 keys", () => {
    const { treatment_status } = buildLeadershipSummary(
      [], [], [], treatmentSummaryRow, [], null, null
    );
    expect(Object.keys(treatment_status).sort()).toEqual([
      "in_progress_count",
      "overdue_count",
      "total_active_count"
    ]);
  });
});

// ---------------------------------------------------------------------------
// recent_signals
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — recent_signals", () => {
  it("includes all seeded signal rows", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals.length).toBe(2);
  });

  it("maps signal id", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.id).toBe("sig-1");
  });

  it("maps signal source", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.source).toBe("cisa");
  });

  it("maps signal_type", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.signal_type).toBe("cve");
  });

  it("maps severity", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.severity).toBe("Critical");
  });

  it("maps normalized_summary", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.normalized_summary).toBe(
      "Critical vulnerability in Acme Payment Gateway SSL library"
    );
  });

  it("maps affected_vendor when present", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.affected_vendor).toBe("Acme Payment Gateway");
  });

  it("maps null affected_vendor correctly", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[1]!.affected_vendor).toBeNull();
  });

  it("maps affected_cve when present", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.affected_cve).toBe("CVE-2024-12345");
  });

  it("maps null affected_cve correctly", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[1]!.affected_cve).toBeNull();
  });

  it("nests linked_finding when linked_finding_id is present", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.linked_finding).not.toBeNull();
    expect(recent_signals[0]!.linked_finding!.id).toBe("finding-1");
  });

  it("linked_finding has title from finding_title", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.linked_finding!.title).toBe(
      "CVE-2024-12345 affects vendor: Acme Payment Gateway"
    );
  });

  it("linked_finding has severity from finding_severity", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.linked_finding!.severity).toBe("Critical");
  });

  it("linked_finding has domain from finding_domain", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[0]!.linked_finding!.domain).toBe("Vendor Risk");
  });

  it("linked_finding is null when linked_finding_id is null", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, recentSignalRows, null, null
    );
    expect(recent_signals[1]!.linked_finding).toBeNull();
  });

  it("returns empty array when no signals", () => {
    const { recent_signals } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(recent_signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// posture — current snapshot
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — posture.current", () => {
  it("populates current snapshot_date", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.current!.snapshot_date).toBe("2026-04-14");
  });

  it("populates current overall_score", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.current!.overall_score).toBe(62);
  });

  it("populates current overall_severity", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.current!.overall_severity).toBe("High");
  });

  it("populates current open_finding_count", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.current!.open_finding_count).toBe(8);
  });

  it("current is null when no snapshot provided", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(posture.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// posture — previous snapshot
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — posture.previous", () => {
  it("populates previous snapshot_date", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.previous!.snapshot_date).toBe("2026-04-13");
  });

  it("populates previous overall_score", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.previous!.overall_score).toBe(55);
  });

  it("previous is null when no prior snapshot provided", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, null
    );
    expect(posture.previous).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// posture — trend_direction
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — posture.trend_direction", () => {
  it("returns 'improving' when current score is significantly higher", () => {
    const current: PostureSnapshotRow = {
      ...currentSnapshotRow,
      overall_score: 70
    };
    const previous: PostureSnapshotRow = {
      ...previousSnapshotRow,
      overall_score: 55
    };
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], current, previous
    );
    expect(posture.trend_direction).toBe("improving");
  });

  it("returns 'degrading' when current score is significantly lower", () => {
    const current: PostureSnapshotRow = {
      ...currentSnapshotRow,
      overall_score: 45
    };
    const previous: PostureSnapshotRow = {
      ...previousSnapshotRow,
      overall_score: 60
    };
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], current, previous
    );
    expect(posture.trend_direction).toBe("degrading");
  });

  it("returns 'stable' when scores are within threshold", () => {
    const current: PostureSnapshotRow = {
      ...currentSnapshotRow,
      overall_score: 60
    };
    const previous: PostureSnapshotRow = {
      ...previousSnapshotRow,
      overall_score: 59
    };
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], current, previous
    );
    expect(posture.trend_direction).toBe("stable");
  });

  it("returns 'insufficient_data' when current snapshot is null", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], null, null
    );
    expect(posture.trend_direction).toBe("insufficient_data");
  });

  it("returns 'no_prior_baseline' when current snapshot exists but previous is null (first-ever snapshot)", () => {
    // Distinct from 'insufficient_data': we have a current snapshot but no
    // historical baseline to compare against. This is the expected state after
    // an organization's very first posture snapshot.
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, null
    );
    expect(posture.trend_direction).toBe("no_prior_baseline");
  });

  it("returns 'no_prior_baseline' when previous snapshot is null", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, null
    );
    expect(posture.trend_direction).toBe("no_prior_baseline");
  });

  it("returns 'insufficient_data' when current overall_score is null", () => {
    const snapshotNoScore: PostureSnapshotRow = {
      ...currentSnapshotRow,
      overall_score: null
    };
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], snapshotNoScore, previousSnapshotRow
    );
    expect(posture.trend_direction).toBe("insufficient_data");
  });

  it("returns 'improving' with seeded snapshot data (62 vs 55)", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(posture.trend_direction).toBe("improving");
  });
});

// ---------------------------------------------------------------------------
// full payload shape
// ---------------------------------------------------------------------------

describe("buildLeadershipSummary — full payload shape", () => {
  it("output object has exactly 6 top-level keys", () => {
    const result = buildLeadershipSummary(
      topRiskRows,
      affectedEntityRows,
      highCriticalFindingRows,
      treatmentSummaryRow,
      recentSignalRows,
      currentSnapshotRow,
      previousSnapshotRow
    );
    expect(Object.keys(result).sort()).toEqual([
      "affected_entities",
      "high_critical_findings",
      "posture",
      "recent_signals",
      "top_risks",
      "treatment_status"
    ]);
  });

  it("posture object has exactly 3 keys", () => {
    const { posture } = buildLeadershipSummary(
      [], [], [], null, [], currentSnapshotRow, previousSnapshotRow
    );
    expect(Object.keys(posture).sort()).toEqual([
      "current",
      "previous",
      "trend_direction"
    ]);
  });

  it("fully assembled payload has all sections populated from seeded rows", () => {
    const result = buildLeadershipSummary(
      topRiskRows,
      affectedEntityRows,
      highCriticalFindingRows,
      treatmentSummaryRow,
      recentSignalRows,
      currentSnapshotRow,
      previousSnapshotRow
    );
    expect(result.top_risks.length).toBeGreaterThan(0);
    expect(result.affected_entities.length).toBeGreaterThan(0);
    expect(result.high_critical_findings.length).toBeGreaterThan(0);
    expect(result.treatment_status.in_progress_count).toBeGreaterThan(0);
    expect(result.recent_signals.length).toBeGreaterThan(0);
    expect(result.posture.current).not.toBeNull();
    expect(result.posture.previous).not.toBeNull();
  });
});
