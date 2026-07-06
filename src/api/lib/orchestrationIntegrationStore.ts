/**
 * orchestrationIntegrationStore.ts — ERIP E6a: tenant-scoped CRUD for
 * orchestration_integrations (20260818), the per-org outbound-channel config
 * (ServiceNow / Jira / Teams / Slack / Email). Mirrors connectorConfigStore:
 * config objects are AES-256-GCM-encrypted at the app layer (fieldEncryption)
 * before hitting the DB; secret VALUES never leave this module toward a route
 * response — the redacted projection exposes configured field KEYS only.
 */

import { pg } from "../infra/postgres.js";
import { encryptField, decryptField } from "./fieldEncryption.js";

export const INTEGRATION_IDS = ["servicenow", "jira", "teams", "slack", "email"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export function isIntegrationId(v: unknown): v is IntegrationId {
  return typeof v === "string" && (INTEGRATION_IDS as readonly string[]).includes(v);
}

export interface IntegrationRow {
  id: string;
  organization_id: string;
  integration_id: string;
  config_encrypted: string;
  enabled: boolean;
}

const COLS = "id, organization_id, integration_id, config_encrypted, enabled";

export async function getIntegrationRow(orgId: string, integrationId: string): Promise<IntegrationRow | null> {
  const r = await pg.query(
    `SELECT ${COLS} FROM orchestration_integrations WHERE organization_id = $1 AND integration_id = $2 LIMIT 1`,
    [orgId, integrationId]
  );
  return (r.rows[0] as IntegrationRow | undefined) ?? null;
}

export async function listIntegrationRows(orgId: string): Promise<IntegrationRow[]> {
  const r = await pg.query(
    `SELECT ${COLS} FROM orchestration_integrations WHERE organization_id = $1 ORDER BY integration_id`,
    [orgId]
  );
  return r.rows as IntegrationRow[];
}

export async function upsertIntegrationConfig(
  orgId: string,
  integrationId: string,
  config: Record<string, string>,
  enabled: boolean
): Promise<IntegrationRow> {
  const encrypted = encryptField(JSON.stringify(config));
  const r = await pg.query(
    `INSERT INTO orchestration_integrations (organization_id, integration_id, config_encrypted, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, integration_id)
     DO UPDATE SET config_encrypted = EXCLUDED.config_encrypted, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING ${COLS}`,
    [orgId, integrationId, encrypted, enabled]
  );
  return r.rows[0] as IntegrationRow;
}

export async function deleteIntegrationConfig(orgId: string, integrationId: string): Promise<boolean> {
  const r = await pg.query(
    `DELETE FROM orchestration_integrations WHERE organization_id = $1 AND integration_id = $2`,
    [orgId, integrationId]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Decrypt a row's config; null on parse failure. */
export function decryptIntegrationConfig(row: Pick<IntegrationRow, "config_encrypted">): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(decryptField(row.config_encrypted));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return null;
  }
}

/** Route-facing projection: field KEYS only — never values, never ciphertext. */
export function redactIntegrationRow(row: IntegrationRow): {
  integration_id: string;
  configured: true;
  config_keys: string[];
  enabled: boolean;
} {
  const config = decryptIntegrationConfig(row);
  return {
    integration_id: row.integration_id,
    configured: true,
    config_keys: config ? Object.keys(config).sort() : [],
    enabled: row.enabled
  };
}
