/**
 * registry.ts — the ECL connector registry (Slice 8). All named connectors from the
 * roadmap, each with a config schema. ServiceNow CMDB is the fully-implemented
 * REFERENCE adapter; the rest are 'planned' — config schema present so the operator
 * can be provisioned + ledgered now, `normalize()`/`fetch()` throw `connector_not_implemented`
 * until their reference-mirroring adapter lands. All DARK: nothing is wired to a route
 * or worker; behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED + a per-connector flag at
 * the eventual call site. Credentials are operator-owned (operator ledger L-5.*).
 */

import { type ConnectorAdapter, type ConnectorConfigField, plannedAdapter } from "./types.js";
import { serviceNowCmdbAdapter } from "./serviceNowCmdb.js";

const URL_FIELD = (label: string): ConnectorConfigField => ({ key: "base_url", label, required: true, kind: "url" });
const TOKEN_FIELD: ConnectorConfigField = { key: "api_token", label: "API token", required: true, kind: "secret" };

const PLANNED: ConnectorAdapter[] = [
  plannedAdapter("microsoft_defender", "Microsoft Defender", "endpoint", [
    { key: "tenant_id", label: "Azure tenant ID", required: true, kind: "string" },
    { key: "client_id", label: "App registration client ID", required: true, kind: "string" },
    { key: "client_secret", label: "Client secret", required: true, kind: "secret" }
  ]),
  plannedAdapter("crowdstrike_falcon", "CrowdStrike Falcon", "endpoint", [
    URL_FIELD("Falcon API base URL"),
    { key: "client_id", label: "Falcon client ID", required: true, kind: "string" },
    { key: "client_secret", label: "Falcon client secret", required: true, kind: "secret" }
  ]),
  plannedAdapter("wiz", "Wiz", "cloud", [URL_FIELD("Wiz API endpoint"), { key: "client_id", label: "Wiz client ID", required: true, kind: "string" }, { key: "client_secret", label: "Wiz client secret", required: true, kind: "secret" }]),
  plannedAdapter("tenable", "Tenable", "vulnerability", [URL_FIELD("Tenable.io base URL"), { key: "access_key", label: "Access key", required: true, kind: "secret" }, { key: "secret_key", label: "Secret key", required: true, kind: "secret" }]),
  plannedAdapter("qualys", "Qualys", "vulnerability", [URL_FIELD("Qualys API base URL"), { key: "username", label: "Username", required: true, kind: "string" }, { key: "password", label: "Password", required: true, kind: "secret" }]),
  plannedAdapter("rapid7", "Rapid7 InsightVM", "vulnerability", [URL_FIELD("InsightVM base URL"), TOKEN_FIELD]),
  plannedAdapter("cloud_inventory", "Cloud Inventory (AWS/Azure/GCP)", "cloud", [
    { key: "provider", label: "Cloud provider", required: true, kind: "string" },
    { key: "account_id", label: "Account / subscription / project ID", required: true, kind: "string" },
    { key: "role_arn_or_credential", label: "Assumed role ARN or credential ref", required: true, kind: "secret" }
  ]),
  plannedAdapter("identity_provider", "Identity Provider (Okta/Entra)", "identity", [URL_FIELD("IdP base URL"), TOKEN_FIELD])
];

const ALL: ConnectorAdapter[] = [serviceNowCmdbAdapter, ...PLANNED];

const BY_ID: ReadonlyMap<string, ConnectorAdapter> = new Map(ALL.map((c) => [c.id, c]));

/** All registered connectors (reference + planned). */
export function listConnectors(): ConnectorAdapter[] {
  return [...ALL];
}

/** Look up a connector by id, or undefined. */
export function getConnector(id: string): ConnectorAdapter | undefined {
  return BY_ID.get(id);
}

/** The connector ids the roadmap requires — used by the registry-completeness test. */
export const REQUIRED_CONNECTOR_IDS = [
  "servicenow_cmdb",
  "microsoft_defender",
  "crowdstrike_falcon",
  "wiz",
  "tenable",
  "qualys",
  "rapid7",
  "cloud_inventory",
  "identity_provider"
] as const;
