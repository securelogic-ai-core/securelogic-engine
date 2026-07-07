/**
 * connectors.ts — pure, I/O-free types + helpers for the Enterprise Systems
 * connect surface (`/assets/connect`). Mirrors the engine's GET /api/connectors
 * projection (src/api/routes/connectors.ts → listOrgConnectors): every registry
 * adapter merged with the org's saved connector row (configured / enabled /
 * last-sync status). No fetch here (the app's pure-function test convention);
 * the fetch wrapper lives in api.ts.
 *
 * Dark: the engine DOUBLE-fences /api/connectors behind BOTH
 * SECURELOGIC_ASSET_REGISTRY_ENABLED and SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED
 * and requires the `enterprise_context` capability. Reads classify via
 * connectorsReadFailure (disabled / capability / error).
 */

export type ConnectorCategory = "cmdb" | "vulnerability" | "cloud" | "identity" | "endpoint";

/** One row of GET /api/connectors — a registry adapter + this org's config state. */
export interface OrgConnector {
  connector_id: string;
  display_name: string;
  /** Registry category; kept as string so an unknown value renders rather than throws. */
  category: ConnectorCategory | string;
  /** 'reference' = fetch+normalize implemented; 'planned' = config schema only. */
  adapter_status: string;
  configured: boolean;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  sync_interval_minutes: number | null;
  next_sync_at: string | null;
  consecutive_failures: number;
  config_fields: Array<{ key: string; label: string; required: boolean; kind: string }>;
  config_keys: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  cmdb: "CMDB & ITSM",
  cloud: "Cloud Infrastructure",
  vulnerability: "Vulnerability Management",
  identity: "Identity & Directory",
  endpoint: "Endpoint & Device",
};

/** Stable render order for the known categories (unknown ones append, alpha). */
export const CONNECTOR_CATEGORY_ORDER: readonly string[] = [
  "cmdb",
  "cloud",
  "vulnerability",
  "identity",
  "endpoint",
];

export function connectorCategoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value;
}

export interface ConnectorGroup {
  category: string;
  label: string;
  connectors: OrgConnector[];
}

/** Group connectors by category in a stable order; connectors sorted by name. */
export function groupConnectorsByCategory(connectors: OrgConnector[]): ConnectorGroup[] {
  const byCat = new Map<string, OrgConnector[]>();
  for (const c of connectors) {
    const list = byCat.get(c.category);
    if (list) list.push(c);
    else byCat.set(c.category, [c]);
  }
  const sortByName = (list: OrgConnector[]) =>
    [...list].sort((a, b) => a.display_name.localeCompare(b.display_name));

  const groups: ConnectorGroup[] = [];
  for (const cat of CONNECTOR_CATEGORY_ORDER) {
    const list = byCat.get(cat);
    if (list) {
      groups.push({ category: cat, label: connectorCategoryLabel(cat), connectors: sortByName(list) });
      byCat.delete(cat);
    }
  }
  // Any unknown categories, alphabetically after the known ones.
  for (const cat of [...byCat.keys()].sort()) {
    groups.push({ category: cat, label: connectorCategoryLabel(cat), connectors: sortByName(byCat.get(cat)!) });
  }
  return groups;
}

export type ConnectorStatusTone = "active" | "configured" | "idle";

/**
 * Short status descriptor for a connector row. Never "coming soon" — the config
 * + sync backend exists (PUT /api/connectors/:id); an unconfigured connector is
 * simply "Not connected" pending an admin credentialing it.
 */
export function connectorStatusLabel(
  c: Pick<OrgConnector, "configured" | "enabled">,
): { text: string; tone: ConnectorStatusTone } {
  if (c.enabled) return { text: "Connected", tone: "active" };
  if (c.configured) return { text: "Configured", tone: "configured" };
  return { text: "Not connected", tone: "idle" };
}

/** Human copy for a failed connectors read (mirrors assetsReadFailure classification). */
export function connectorsReadFailure(result: { disabled: boolean; error: string }): {
  kind: "disabled" | "capability" | "error";
  message: string;
} {
  if (result.disabled) {
    return {
      kind: "disabled",
      message: "Enterprise connectors aren't available for your organization yet.",
    };
  }
  if (result.error === "capability_required") {
    return {
      kind: "capability",
      message: "Your organization doesn't have access to enterprise connectors.",
    };
  }
  return {
    kind: "error",
    message: "Something went wrong loading connectors. Please try again.",
  };
}
