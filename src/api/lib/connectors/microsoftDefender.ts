/**
 * microsoftDefender.ts — Microsoft Defender for Endpoint connector (R7).
 *
 * Mirrors the ServiceNow reference: `fetch()` is the only I/O (injected
 * HttpClient), `normalize()` is pure. Auth = OAuth2 client-credentials against
 * the operator's Azure app registration (ledger L-5.2), then the Defender
 * machines API. Machines normalize to ECL `asset` entities; criticality maps
 * from Defender's exposure level. No relationship data on this surface.
 * DARK: nothing calls any connector; per-connector flag at the eventual call site.
 */

import {
  requirePostForm,
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "tenant_id", label: "Azure tenant ID", required: true, kind: "string" },
  { key: "client_id", label: "App registration client ID", required: true, kind: "string" },
  { key: "client_secret", label: "Client secret", required: true, kind: "secret" }
];

const API_BASE = "https://api.securitycenter.microsoft.com";

interface DefenderMachine {
  id?: unknown;
  computerDnsName?: unknown;
  osPlatform?: unknown;
  exposureLevel?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Defender exposureLevel (None/Low/Medium/High) → ECL criticality. */
function mapExposure(raw: unknown): NormalizedEntity["criticality"] | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.toLowerCase();
  if (v === "high") return "high";
  if (v === "medium") return "medium";
  if (v === "low" || v === "none") return "low";
  return undefined;
}

export const microsoftDefenderAdapter: ConnectorAdapter = {
  id: "microsoft_defender",
  displayName: "Microsoft Defender",
  status: "implemented",
  category: "endpoint",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { tenant_id, client_id, client_secret } = config;
    if (!tenant_id || !client_id || !client_secret) {
      throw new Error("microsoft_defender: incomplete config (validateConfig must pass first)");
    }
    const postForm = requirePostForm(http, "microsoft_defender");
    const token = (await postForm(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant_id)}/oauth2/v2.0/token`,
      { Accept: "application/json" },
      {
        grant_type: "client_credentials",
        client_id,
        client_secret,
        scope: `${API_BASE}/.default`
      }
    )) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("microsoft_defender: token endpoint returned no access_token");

    return http.getJson(`${API_BASE}/api/machines`, {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const value = (raw as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const m of value as DefenderMachine[]) {
      const id = str(m.id);
      const name = str(m.computerDnsName);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const os = str(m.osPlatform);
      if (os) entity.description = `Defender-managed device (${os})`;
      const crit = mapExposure(m.exposureLevel);
      if (crit) entity.criticality = crit;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
