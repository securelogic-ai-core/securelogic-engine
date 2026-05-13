/**
 * Test fixture: a realistic VendorAssuranceExportBundle, used by the Excel and
 * PDF exporter unit tests. Not a test file itself (no `.test.ts` suffix), so the
 * vitest glob ignores it.
 */

import { MATERIAL_FIELDS } from "../../lib/socExtractionPrompt.js";
import type {
  VendorAssuranceExportBundle,
  VendorAssuranceCuecRow
} from "../../lib/vendorAssuranceExportModel.js";

function cuec(partial: Partial<VendorAssuranceCuecRow> & Pick<VendorAssuranceCuecRow, "id" | "ordinal" | "cuec_text">): VendorAssuranceCuecRow {
  return {
    review_status: "pending",
    review_status_reason: null,
    review_status_updated_by_user_id: null,
    review_status_updated_at: null,
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
    mappings: [],
    ...partial
  };
}

export function makeExportBundle(overrides: Partial<VendorAssuranceExportBundle> = {}): VendorAssuranceExportBundle {
  const base: VendorAssuranceExportBundle = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Northwind Health Systems, Inc.",
    document: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      vendorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      originalFilename: "Acme-Cloud-Infrastructure-SOC2-TypeII-FY2025.pdf",
      byteSize: 1_842_113,
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      documentTypeHint: "SOC 2 Type II",
      processingStatus: "approved",
      uploadedAt: "2026-05-03T14:22:11Z",
      uploadedByUserId: "u-uploader",
      uploadedByName: "Dana Whitfield"
    },
    vendorRecordName: "Acme Cloud Infrastructure",
    extraction: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      modelId: "claude-sonnet-4-6",
      promptVersion: "soc-extraction-v2",
      createdAt: "2026-05-03T14:24:40Z",
      fields: {
        vendor_name: { value: "Acme Cloud Infrastructure, Inc.", confidence: 0.97 },
        report_type: { value: "SOC 2 Type II", confidence: 0.95 },
        report_period_start: { value: "2024-10-01", confidence: 0.92 },
        report_period_end: { value: "2025-09-30", confidence: 0.92 },
        report_issued_date: { value: "2025-11-14", confidence: 0.9 },
        auditor_name: { value: "Sterling & Reeve LLP", confidence: 0.88 },
        auditor_opinion: { value: "Unqualified", confidence: 0.86 },
        trust_services_criteria: { value: ["Security", "Availability", "Confidentiality"], confidence: 0.9 },
        subservice_method: { value: "Carve-out", confidence: 0.8 },
        subservice_organizations: { value: ["Globex Datacenters", "Initech Email"], confidence: 0.78 },
        cuecs: {
          value: [
            "User entities are responsible for restricting physical access to their own facilities.",
            "User entities are responsible for provisioning and de-provisioning their own user accounts.",
            "User entities are responsible for configuring multi-factor authentication for privileged users."
          ],
          confidence: 0.85
        },
        controls: {
          value: [
            { control_id: "CC6.1", description: "Logical access provisioning", test_procedure: "Inspected access requests", result: "No exceptions" },
            { control_id: "CC7.2", description: "Change management approvals", test_procedure: "Inspected change tickets", result: "No exceptions" }
          ],
          confidence: 0.82
        },
        exceptions: {
          value: [
            { control_id: "CC7.2", description: "For 2 of 25 changes sampled, evidence of approval prior to deployment could not be located.", auditor_assessment: "Deviation noted; management remediated mid-period." }
          ],
          confidence: 0.8
        },
        management_responses: {
          value: [
            { exception_ref: "CC7.2", response: "Management implemented an enforced approval gate in the deployment pipeline on 2025-04-01; no further deviations observed." }
          ],
          confidence: 0.8
        }
      }
    },
    fieldOverrides: [
      {
        fieldName: "auditor_name",
        originalValue: "Sterling Reeve LLP",
        overrideValue: "Sterling & Reeve LLP",
        reason: "Auditor name on the cover page includes an ampersand; the model dropped it.",
        overriddenByUserId: "u-reviewer",
        overriddenByName: "Marcus Lin",
        overriddenAt: "2026-05-07T11:05:00Z"
      }
    ],
    report: {
      vendorName: "Acme Cloud Infrastructure, Inc.",
      reportType: "SOC 2 Type II",
      reportPeriodStart: "2024-10-01",
      reportPeriodEnd: "2025-09-30",
      reportIssuedDate: "2025-11-14",
      auditorName: "Sterling & Reeve LLP",
      auditorOpinion: "Unqualified",
      trustServicesCriteria: ["Security", "Availability", "Confidentiality"],
      subserviceMethod: "Carve-out",
      subserviceOrganizations: ["Globex Datacenters", "Initech Email"]
    },
    controls: [
      { controlId: "CC6.1", description: "Logical access provisioning", testProcedure: "Inspected access requests", result: "No exceptions" },
      { controlId: "CC7.2", description: "Change management approvals", testProcedure: "Inspected change tickets", result: "No exceptions" }
    ],
    exceptions: [
      {
        controlId: "CC7.2",
        description: "For 2 of 25 changes sampled, evidence of approval prior to deployment could not be located.",
        auditorAssessment: "Deviation noted; management remediated mid-period.",
        managementResponse: "Management implemented an enforced approval gate in the deployment pipeline on 2025-04-01; no further deviations observed."
      }
    ],
    cuecs: [
      cuec({
        id: "cuec-1", ordinal: 1,
        cuec_text: "User entities are responsible for restricting physical access to their own facilities.",
        mappings: [
          {
            id: "m-1", cuec_id: "cuec-1", control_id: "ctl-phys",
            mapping_status: "accepted", mapping_score: 87, mapping_source: "auto", reason: "Strong overlap with the facility access policy.",
            created_by_user_id: null, updated_by_user_id: "u-reviewer", created_at: "2026-05-05T00:00:00Z", updated_at: "2026-05-06T09:00:00Z",
            control_name: "Physical Facility Access Control", control_description: "Badge access, visitor logs, quarterly access reviews", control_status: "active"
          },
          {
            id: "m-2", cuec_id: "cuec-1", control_id: "ctl-dc",
            mapping_status: "accepted", mapping_score: null, mapping_source: "manual", reason: "Added by reviewer — also covered by the datacenter colocation control.",
            created_by_user_id: "u-reviewer", updated_by_user_id: "u-reviewer", created_at: "2026-05-06T10:00:00Z", updated_at: "2026-05-06T10:00:00Z",
            control_name: "Datacenter Colocation Oversight", control_description: "Annual review of colocation provider attestations", control_status: "active"
          },
          {
            id: "m-3", cuec_id: "cuec-1", control_id: "ctl-old",
            mapping_status: "dismissed", mapping_score: 62, mapping_source: "auto", reason: "Not actually about physical access.",
            created_by_user_id: null, updated_by_user_id: "u-reviewer", created_at: "2026-05-05T00:00:00Z", updated_at: "2026-05-06T09:30:00Z",
            control_name: "Clean Desk Policy", control_description: "Workspace tidiness", control_status: "active"
          }
        ]
      }),
      cuec({
        id: "cuec-2", ordinal: 2,
        cuec_text: "User entities are responsible for provisioning and de-provisioning their own user accounts.",
        review_status: "reviewed_no_match",
        review_status_reason: "We outsource identity management entirely to a managed IdP; no internal control applies.",
        review_status_updated_by_user_id: "u-reviewer",
        review_status_updated_at: "2026-05-06T11:00:00Z",
        mappings: [
          {
            id: "m-4", cuec_id: "cuec-2", control_id: "ctl-iam",
            mapping_status: "suggested", mapping_score: 71, mapping_source: "auto", reason: null,
            created_by_user_id: null, updated_by_user_id: null, created_at: "2026-05-05T00:00:00Z", updated_at: "2026-05-05T00:00:00Z",
            control_name: "Identity & Access Management", control_description: "Joiner/mover/leaver process", control_status: "active"
          }
        ]
      }),
      cuec({
        id: "cuec-3", ordinal: 3,
        cuec_text: "User entities are responsible for configuring multi-factor authentication for privileged users."
        // pending — no mappings, no review_status change
      })
    ],
    cuecSummary: { total: 3, mapped: 1, noApplicableControl: 1, pending: 1 },
    review: { state: "approved", reviewerUserId: "u-reviewer", reviewerName: "Marcus Lin", reviewedAt: "2026-05-09T16:40:02Z" },
    export: { exportedAt: "2026-05-12T22:06:00Z", exportedByUserId: "u-reviewer", exportedByName: "Marcus Lin" },
    userNamesById: { "u-uploader": "Dana Whitfield", "u-reviewer": "Marcus Lin" },
    materialFields: MATERIAL_FIELDS
  };

  return { ...base, ...overrides };
}
