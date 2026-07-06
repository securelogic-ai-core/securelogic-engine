/**
 * registry.ts — the ECL connector registry (Slice 8 framework + R7 adapters).
 * All nine roadmap connectors are now IMPLEMENTED: ServiceNow CMDB is the
 * original fully-worked REFERENCE adapter; the other eight ship real
 * `fetch()`/`normalize()` implementations mirroring it (R7), each mock-tested.
 * Wired since EAR Phase 3b: config + sync routes (routes/connectors.ts) and the
 * connector sync worker (workers/connectorSyncWorker.ts), double-fenced behind
 * SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED
 * (both default off) with per-org row-level activation (enterprise_connectors
 * .enabled). Credentials + real-API round-trips are operator-owned (ledger L-5.*).
 */

import type { ConnectorAdapter } from "./types.js";
import { serviceNowCmdbAdapter } from "./serviceNowCmdb.js";
import { microsoftDefenderAdapter } from "./microsoftDefender.js";
import { crowdstrikeFalconAdapter } from "./crowdstrikeFalcon.js";
import { wizAdapter } from "./wiz.js";
import { tenableAdapter } from "./tenable.js";
import { qualysAdapter } from "./qualys.js";
import { rapid7Adapter } from "./rapid7.js";
import { cloudInventoryAdapter } from "./cloudInventory.js";
import { identityProviderAdapter } from "./identityProvider.js";

const ALL: ConnectorAdapter[] = [
  serviceNowCmdbAdapter,
  microsoftDefenderAdapter,
  crowdstrikeFalconAdapter,
  wizAdapter,
  tenableAdapter,
  qualysAdapter,
  rapid7Adapter,
  cloudInventoryAdapter,
  identityProviderAdapter
];

const BY_ID: ReadonlyMap<string, ConnectorAdapter> = new Map(ALL.map((c) => [c.id, c]));

/** All registered connectors. */
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
