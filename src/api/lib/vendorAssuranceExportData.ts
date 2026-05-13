/**
 * vendorAssuranceExportData.ts — the export bundle assembler (the DB layer).
 *
 * `buildExportBundle(documentId, organizationId, opts)` assembles, in one place,
 * everything the Excel exporter (vendorAssuranceExcelExporter.ts) and the PDF
 * exporter (vendorAssurancePdfExporter.ts) need to render a customer-deliverable
 * artifact: the document row + uploader / reviewer / org display names, the
 * extraction fields with the latest reviewer overrides applied, the CUEC rows
 * with their control mappings, the auditor exceptions paired with management
 * responses, and the point-in-time review state.
 *
 * This module is the only part of the export package that talks to Postgres.
 * The bundle's data shapes and all the pure derivations / formatters live in
 * vendorAssuranceExportModel.ts (no DB import), and are re-exported here for
 * convenience — so a render-layer consumer can `import { ... } from
 * vendorAssuranceExportModel.js` and stay DB-free, while a route can pull
 * `buildExportBundle` + the formatters from this one module.
 *
 * Tenant scoping: every query is keyed by `organization_id`; a document that
 * does not belong to `organizationId` yields `null` (the route turns that into
 * a 404). Read-only — this module never writes anything.
 *
 * `loadCuecsWithMappings` lived in vendorAssuranceDocuments.ts before this
 * package; it moved here so the export builders and the CUEC routes share one
 * implementation.
 */

import { pg } from "../infra/postgres.js";
import {
  asNullableString,
  asStringArray,
  summarizeCuecs,
  type ExtractedFieldValue,
  type FieldOverrideEntry,
  type ExceptionEntry,
  type ControlEntry,
  type VendorAssuranceCuecRow,
  type VendorAssuranceCuecMappingRow,
  type VendorAssuranceExportBundle
} from "./vendorAssuranceExportModel.js";
import { MATERIAL_FIELDS } from "./socExtractionPrompt.js";

// Re-export the pure model surface so a route can grab the formatters here too.
export * from "./vendorAssuranceExportModel.js";

/* =========================================================
   CUEC rows + control mappings
   ========================================================= */

/** Load a document's CUEC rows with their control mappings (control name/desc/status joined). */
export async function loadCuecsWithMappings(
  documentId: string,
  organizationId: string
): Promise<VendorAssuranceCuecRow[]> {
  const cuecRes = await pg.query<Omit<VendorAssuranceCuecRow, "mappings">>(
    `SELECT id, ordinal, cuec_text, review_status, review_status_reason,
            review_status_updated_by_user_id, review_status_updated_at, created_at, updated_at
       FROM vendor_assurance_cuecs
      WHERE document_id = $1 AND organization_id = $2
      ORDER BY ordinal ASC`,
    [documentId, organizationId]
  );
  if (cuecRes.rows.length === 0) return [];

  const cuecIds = cuecRes.rows.map((c) => c.id);
  const mapRes = await pg.query<VendorAssuranceCuecMappingRow>(
    `SELECT m.id, m.cuec_id, m.control_id, m.mapping_status, m.mapping_score, m.mapping_source,
            m.reason, m.created_by_user_id, m.updated_by_user_id, m.created_at, m.updated_at,
            c.name AS control_name, c.description AS control_description, c.status AS control_status
       FROM vendor_assurance_cuec_control_mappings m
       JOIN controls c ON c.id = m.control_id AND c.organization_id = m.organization_id
      WHERE m.organization_id = $1 AND m.cuec_id = ANY($2::uuid[])
      ORDER BY m.cuec_id,
               CASE m.mapping_status WHEN 'accepted' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
               m.mapping_score DESC NULLS LAST, m.created_at ASC`,
    [organizationId, cuecIds]
  );
  const byCuec = new Map<string, VendorAssuranceCuecMappingRow[]>();
  for (const m of mapRes.rows) {
    let list = byCuec.get(m.cuec_id);
    if (!list) { list = []; byCuec.set(m.cuec_id, list); }
    list.push(m);
  }
  return cuecRes.rows.map((c) => ({ ...c, mappings: byCuec.get(c.id) ?? [] }));
}

/* =========================================================
   buildExportBundle
   ========================================================= */

export interface BuildExportBundleOptions {
  /** The user UUID performing the export (from req.userId); resolved to a display name for the cover. */
  exportedByUserId?: string | null;
  /** Override the export timestamp (tests). Defaults to now. */
  exportedAt?: Date;
}

export async function buildExportBundle(
  documentId: string,
  organizationId: string,
  opts: BuildExportBundleOptions = {}
): Promise<VendorAssuranceExportBundle | null> {
  // ---- 1. Document row + uploader / reviewer / org / vendor display names ----
  const docRes = await pg.query<{
    id: string;
    organization_id: string;
    vendor_id: string;
    uploaded_by_user_id: string | null;
    original_filename: string;
    byte_size: number;
    sha256: string;
    document_type_hint: string | null;
    processing_status: string;
    created_at: string;
    approved_at: string | null;
    approved_by_user_id: string | null;
    finalized_at: string | null;
    finalized_by_user_id: string | null;
    uploaded_by_name: string | null;
    approved_by_name: string | null;
    finalized_by_name: string | null;
    organization_name: string;
    vendor_record_name: string | null;
  }>(
    `SELECT d.id, d.organization_id, d.vendor_id, d.uploaded_by_user_id,
            d.original_filename, d.byte_size, d.sha256, d.document_type_hint,
            d.processing_status, d.created_at,
            d.approved_at, d.approved_by_user_id, d.finalized_at, d.finalized_by_user_id,
            up.name AS uploaded_by_name,
            ap.name AS approved_by_name,
            fp.name AS finalized_by_name,
            o.name  AS organization_name,
            v.name  AS vendor_record_name
       FROM vendor_assurance_documents d
       JOIN organizations o ON o.id = d.organization_id
       LEFT JOIN users   up ON up.id = d.uploaded_by_user_id
       LEFT JOIN users   ap ON ap.id = d.approved_by_user_id
       LEFT JOIN users   fp ON fp.id = d.finalized_by_user_id
       LEFT JOIN vendors v  ON v.id = d.vendor_id AND v.organization_id = d.organization_id
      WHERE d.id = $1 AND d.organization_id = $2
      LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docRes.rowCount ?? 0) === 0) return null;
  const d = docRes.rows[0]!;

  // ---- 2. Extraction (fields jsonb) ----
  const extractionRes = await pg.query<{
    id: string;
    model_id: string;
    prompt_version: string;
    fields: Record<string, ExtractedFieldValue | undefined> | null;
    created_at: string;
  }>(
    `SELECT id, model_id, prompt_version, fields, created_at
       FROM vendor_assurance_extractions
      WHERE document_id = $1 AND organization_id = $2
      LIMIT 1`,
    [documentId, organizationId]
  );
  const extractionRow = extractionRes.rows[0] ?? null;
  const fields: Record<string, ExtractedFieldValue | undefined> = extractionRow?.fields ?? {};

  // ---- 3. Latest reviewer override per field (+ reviewer display name) ----
  const overridesRes = await pg.query<{
    field_name: string;
    original_value: unknown;
    override_value: unknown;
    reason: string;
    overridden_by_user_id: string | null;
    overridden_at: string;
    overridden_by_name: string | null;
  }>(
    `SELECT DISTINCT ON (fo.field_name)
            fo.field_name, fo.original_value, fo.override_value, fo.reason,
            fo.overridden_by_user_id, fo.overridden_at,
            ou.name AS overridden_by_name
       FROM vendor_assurance_field_overrides fo
       LEFT JOIN users ou ON ou.id = fo.overridden_by_user_id
      WHERE fo.document_id = $1 AND fo.organization_id = $2
      ORDER BY fo.field_name, fo.overridden_at DESC, fo.id DESC`,
    [documentId, organizationId]
  );
  const fieldOverrides: FieldOverrideEntry[] = overridesRes.rows.map((r) => ({
    fieldName: r.field_name,
    originalValue: r.original_value,
    overrideValue: r.override_value,
    reason: r.reason,
    overriddenByUserId: r.overridden_by_user_id,
    overriddenByName: r.overridden_by_name,
    overriddenAt: r.overridden_at
  }));
  const overrideByField = new Map<string, FieldOverrideEntry>();
  for (const o of fieldOverrides) overrideByField.set(o.fieldName, o);

  /** Current value of a material field: latest override's value if one exists, else the extraction value. */
  const currentValue = (fieldName: string): unknown => {
    const ov = overrideByField.get(fieldName);
    if (ov) return ov.overrideValue;
    return fields[fieldName]?.value ?? null;
  };

  // ---- 4. CUEC rows + control mappings ----
  const cuecs = await loadCuecsWithMappings(documentId, organizationId);
  const cuecSummary = summarizeCuecs(cuecs);

  // ---- 5. Review state (point-in-time) ----
  const status = d.processing_status;
  let reviewerUserId: string | null = null;
  let reviewerName: string | null = null;
  let reviewedAt: string | null = null;
  if (status === "approved") {
    reviewerUserId = d.approved_by_user_id;
    reviewerName = d.approved_by_name;
    reviewedAt = d.approved_at;
  } else if (status === "finalized") {
    reviewerUserId = d.finalized_by_user_id;
    reviewerName = d.finalized_by_name;
    reviewedAt = d.finalized_at;
  } else if (status === "manual_review_requested" || status === "rejected") {
    const eventType =
      status === "manual_review_requested"
        ? "vendor_assurance.document.manual_review_requested"
        : "vendor_assurance.document.rejected";
    const auditRes = await pg.query<{ actor_user_id: string | null; created_at: string; actor_name: string | null }>(
      `SELECT al.actor_user_id, al.created_at, au.name AS actor_name
         FROM security_audit_log al
         LEFT JOIN users au ON au.id = al.actor_user_id
        WHERE al.organization_id = $1 AND al.resource_id = $2 AND al.event_type = $3
        ORDER BY al.created_at DESC
        LIMIT 1`,
      [organizationId, documentId, eventType]
    );
    const a = auditRes.rows[0];
    if (a) {
      reviewerUserId = a.actor_user_id;
      reviewerName = a.actor_name;
      reviewedAt = a.created_at;
    }
  }

  // ---- 6. Exporting user's display name ----
  let exportedByName: string | null = null;
  const exportedByUserId = opts.exportedByUserId ?? null;
  if (exportedByUserId) {
    const uRes = await pg.query<{ name: string | null }>(
      `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      [exportedByUserId]
    );
    exportedByName = uRes.rows[0]?.name ?? null;
  }

  // ---- Exceptions paired with management responses (best-effort) ----
  const rawExceptions = Array.isArray(currentValue("exceptions")) ? (currentValue("exceptions") as unknown[]) : [];
  const rawResponses = Array.isArray(currentValue("management_responses"))
    ? (currentValue("management_responses") as unknown[])
    : [];
  const exceptions: ExceptionEntry[] = rawExceptions.map((e, i) => {
    const obj = (e && typeof e === "object" ? (e as Record<string, unknown>) : {}) as Record<string, unknown>;
    const controlId = asNullableString(obj["control_id"]);
    // Match a management response by exception_ref == control_id, else fall back to index alignment.
    let response: string | null = null;
    if (controlId) {
      const matched = rawResponses.find((r) => {
        const ro = (r && typeof r === "object" ? (r as Record<string, unknown>) : {});
        const ref = asNullableString(ro["exception_ref"]);
        return ref !== null && ref.toLowerCase() === controlId.toLowerCase();
      });
      if (matched && typeof matched === "object") response = asNullableString((matched as Record<string, unknown>)["response"]);
    }
    if (response === null) {
      const byIndex = rawResponses[i];
      if (byIndex && typeof byIndex === "object") response = asNullableString((byIndex as Record<string, unknown>)["response"]);
    }
    return {
      controlId,
      description: asNullableString(obj["description"]) ?? "",
      auditorAssessment: asNullableString(obj["auditor_assessment"]),
      managementResponse: response
    };
  });

  // ---- Controls tested ----
  const rawControls = Array.isArray(currentValue("controls")) ? (currentValue("controls") as unknown[]) : [];
  const controls: ControlEntry[] = rawControls.map((c) => {
    const obj = (c && typeof c === "object" ? (c as Record<string, unknown>) : {}) as Record<string, unknown>;
    return {
      controlId: asNullableString(obj["control_id"]),
      description: asNullableString(obj["description"]) ?? "",
      testProcedure: asNullableString(obj["test_procedure"]),
      result: asNullableString(obj["result"])
    };
  });

  // ---- 7. Display names for every user UUID referenced (one batch lookup) ----
  const userNamesById: Record<string, string> = {};
  // Seed with names already resolved via joins above so the map is complete even if the batch query misses one.
  if (d.uploaded_by_user_id && d.uploaded_by_name) userNamesById[d.uploaded_by_user_id] = d.uploaded_by_name;
  if (d.approved_by_user_id && d.approved_by_name) userNamesById[d.approved_by_user_id] = d.approved_by_name;
  if (d.finalized_by_user_id && d.finalized_by_name) userNamesById[d.finalized_by_user_id] = d.finalized_by_name;
  if (reviewerUserId && reviewerName) userNamesById[reviewerUserId] = reviewerName;
  if (exportedByUserId && exportedByName) userNamesById[exportedByUserId] = exportedByName;
  for (const o of fieldOverrides) if (o.overriddenByUserId && o.overriddenByName) userNamesById[o.overriddenByUserId] = o.overriddenByName;

  const extraUserIds = new Set<string>();
  for (const c of cuecs) {
    if (c.review_status_updated_by_user_id && !userNamesById[c.review_status_updated_by_user_id]) extraUserIds.add(c.review_status_updated_by_user_id);
    for (const m of c.mappings) {
      if (m.created_by_user_id && !userNamesById[m.created_by_user_id]) extraUserIds.add(m.created_by_user_id);
      if (m.updated_by_user_id && !userNamesById[m.updated_by_user_id]) extraUserIds.add(m.updated_by_user_id);
    }
  }
  if (extraUserIds.size > 0) {
    const nameRes = await pg.query<{ id: string; name: string | null }>(
      `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`,
      [[...extraUserIds]]
    );
    for (const r of nameRes.rows) if (r.name) userNamesById[r.id] = r.name;
  }

  return {
    organizationId,
    organizationName: d.organization_name,
    document: {
      id: d.id,
      vendorId: d.vendor_id,
      originalFilename: d.original_filename,
      byteSize: d.byte_size,
      sha256: d.sha256,
      documentTypeHint: d.document_type_hint,
      processingStatus: status,
      uploadedAt: d.created_at,
      uploadedByUserId: d.uploaded_by_user_id,
      uploadedByName: d.uploaded_by_name
    },
    vendorRecordName: d.vendor_record_name,
    extraction: extractionRow
      ? {
          id: extractionRow.id,
          modelId: extractionRow.model_id,
          promptVersion: extractionRow.prompt_version,
          createdAt: extractionRow.created_at,
          fields
        }
      : null,
    fieldOverrides,
    report: {
      vendorName: asNullableString(currentValue("vendor_name")),
      reportType: asNullableString(currentValue("report_type")),
      reportPeriodStart: asNullableString(currentValue("report_period_start")),
      reportPeriodEnd: asNullableString(currentValue("report_period_end")),
      reportIssuedDate: asNullableString(currentValue("report_issued_date")),
      auditorName: asNullableString(currentValue("auditor_name")),
      auditorOpinion: asNullableString(currentValue("auditor_opinion")),
      trustServicesCriteria: asStringArray(currentValue("trust_services_criteria")),
      subserviceMethod: asNullableString(currentValue("subservice_method")),
      subserviceOrganizations: asStringArray(currentValue("subservice_organizations"))
    },
    controls,
    exceptions,
    cuecs,
    cuecSummary,
    review: { state: status, reviewerUserId, reviewerName, reviewedAt },
    export: {
      exportedAt: (opts.exportedAt ?? new Date()).toISOString(),
      exportedByUserId,
      exportedByName
    },
    userNamesById,
    materialFields: MATERIAL_FIELDS
  };
}
