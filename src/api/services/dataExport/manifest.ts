/**
 * manifest.ts — the bundle manifest builder (`manifest.json`) for the GDPR/CCPA
 * export engine (PR #2b). The manifest is plain JSON (Decision Q9), written as
 * the last entry in the zip after every data file, so its row counts / sizes /
 * hashes are authoritative for the bundle the subject actually received.
 */

import type {
  ExportManifest,
  ExportScope,
  ManifestAttachmentEntry,
  ManifestTableEntry,
} from "./types.js";

/**
 * Manifest generator version. `2.0.0` marked the first COMPLETE export service
 * layer — the query+streaming core (PR #2a) plus the executor+bundle+manifest
 * (PR #2b) together. `2.1.0` (PR #2d) adds org_full R2 attachment streaming:
 * additive — `attachments[]` is now populated for org_full (with `status` and
 * the nullable size/sha for disclosed gaps) and an `attachments/` zip tree may
 * appear. Bump the MINOR on additive bundle/manifest changes, the MAJOR on a
 * backward-incompatible one (Decision Q10).
 */
export const GENERATOR_VERSION = "2.1.0";

/**
 * The standing GDPR/CCPA explainer embedded in every manifest. Covers the four
 * things a data subject (or their lawyer) needs to interpret the bundle:
 *   • the NDJSON format of the data files (Q9);
 *   • current-email-only matching, with the recycled-email caveat (Q6/Q11);
 *   • that IP / user-agent values in the subject's audit rows are their own data (Q7);
 *   • that tombstoned (deleted) accounts appear with scrubbed PII (Q3, org_full).
 */
export const EXPORT_GDPR_NOTE = [
  "Data files in this bundle are NDJSON: each line under tables/ is one complete JSON object (one database row); there is no enclosing array. The manifest (this file) is plain JSON.",
  "Records are matched to you by your account id and by your CURRENT email address. Historical email addresses are not tracked and are not matched.",
  "Email-keyed records reflect the current holder of your email address. If your email address was previously held by another platform user (rare), records bound to that earlier holder MAY appear in this export. PR #5 will tighten this via verified-email confirmation.",
  "Where your activity is recorded in audit logs, the IP address and related metadata in those rows are part of your own personal data (GDPR Art. 15) and are included.",
  "In a full-organization export, deleted accounts are present in some tables with tombstoned data (personal data scrubbed in place, account identifier preserved for audit integrity). A deleted account's email is no longer matched against email-keyed tables because it was scrubbed during deletion.",
].join("\n\n");

export interface BuildManifestInput {
  exportId: string;
  scope: ExportScope;
  targetUserId: string | null;
  targetOrganizationId: string;
  /** When the export was generated; serialized as ISO-8601. */
  generatedAt: Date;
  /** Latest applied migration filename (Q1), or null when unavailable. */
  schemaVersion: string | null;
  tables: ManifestTableEntry[];
  attachments?: ManifestAttachmentEntry[];
  notes?: string[];
}

/** Assemble the manifest object (snake_case keys = the serialized shape). */
export function buildManifest(input: BuildManifestInput): ExportManifest {
  return {
    export_id: input.exportId,
    scope: input.scope,
    target_user_id: input.targetUserId,
    target_organization_id: input.targetOrganizationId,
    generated_at: input.generatedAt.toISOString(),
    generator_version: GENERATOR_VERSION,
    schema_version: input.schemaVersion,
    tables: input.tables,
    attachments: input.attachments ?? [],
    notes: input.notes ?? [],
    gdpr_note: EXPORT_GDPR_NOTE,
  };
}

/** Serialize the manifest for the `manifest.json` zip entry (pretty-printed). */
export function serializeManifest(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2);
}
