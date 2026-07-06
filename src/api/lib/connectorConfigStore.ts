/**
 * connectorConfigStore.ts — EAR Phase 3b: tenant-scoped CRUD for
 * enterprise_connectors (20260807). Config objects are encrypted at the
 * application layer (fieldEncryption AES-256-GCM — the raw_payload precedent)
 * before hitting the DB and decrypted only where the worker needs credentials.
 * Secret VALUES never leave this module toward a route response: the redacted
 * projection exposes configured field keys only.
 *
 * All queries run on the tenant `pg` proxy (asTenant route / withTenant
 * worker) with explicit org predicates.
 */

import { pg } from "../infra/postgres.js";
import { encryptField, decryptField } from "./fieldEncryption.js";

export interface ConnectorRow {
  id: string;
  organization_id: string;
  connector_id: string;
  config_encrypted: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_summary: Record<string, unknown> | null;
}

const ROW_COLS =
  "id, organization_id, connector_id, config_encrypted, enabled, last_sync_at, last_sync_status, last_sync_summary";

export async function getConnectorRow(orgId: string, connectorId: string): Promise<ConnectorRow | null> {
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM enterprise_connectors
      WHERE organization_id = $1 AND connector_id = $2 LIMIT 1`,
    [orgId, connectorId]
  );
  return (r.rows[0] as ConnectorRow | undefined) ?? null;
}

export async function listConnectorRows(orgId: string): Promise<ConnectorRow[]> {
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM enterprise_connectors
      WHERE organization_id = $1 ORDER BY connector_id`,
    [orgId]
  );
  return r.rows as ConnectorRow[];
}

export async function upsertConnectorConfig(
  orgId: string,
  connectorId: string,
  config: Record<string, string>,
  enabled: boolean
): Promise<ConnectorRow> {
  const encrypted = encryptField(JSON.stringify(config));
  const r = await pg.query(
    `INSERT INTO enterprise_connectors (organization_id, connector_id, config_encrypted, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, connector_id)
     DO UPDATE SET config_encrypted = EXCLUDED.config_encrypted,
                   enabled = EXCLUDED.enabled,
                   updated_at = now()
     RETURNING ${ROW_COLS}`,
    [orgId, connectorId, encrypted, enabled]
  );
  return r.rows[0] as ConnectorRow;
}

export async function deleteConnectorConfig(orgId: string, connectorId: string): Promise<boolean> {
  const r = await pg.query(
    `DELETE FROM enterprise_connectors WHERE organization_id = $1 AND connector_id = $2`,
    [orgId, connectorId]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Decrypt a row's config. Returns null on parse failure (corrupt/legacy value) — caller decides. */
export function decryptConnectorConfig(row: Pick<ConnectorRow, "config_encrypted">): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(decryptField(row.config_encrypted));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Route-facing projection: configured field KEYS only — never values, never ciphertext. */
export function redactConnectorRow(row: ConnectorRow): {
  connector_id: string;
  configured: true;
  config_keys: string[];
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_summary: Record<string, unknown> | null;
} {
  const config = decryptConnectorConfig(row);
  return {
    connector_id: row.connector_id,
    configured: true,
    config_keys: config ? Object.keys(config).sort() : [],
    enabled: row.enabled,
    last_sync_at: row.last_sync_at,
    last_sync_status: row.last_sync_status,
    last_sync_summary: row.last_sync_summary
  };
}
