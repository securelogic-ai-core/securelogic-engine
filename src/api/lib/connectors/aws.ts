/**
 * aws.ts — native AWS cloud connector (ERIP E2.P5).
 *
 * Auth = SigV4 (awsSigV4.ts) against the Resource Groups Tagging API, whose
 * GetResources action returns a JSON inventory of tagged resources across the
 * account/region — a broad, single-call resource list without per-service XML
 * parsing. Each ResourceARN normalizes to a `cloud_resource` asset (the
 * connectorSyncCore cloud lane stamps provider='aws'). `fetch()` is the only
 * I/O (injected HttpClient + a signing clock); `normalize()` is pure. DARK;
 * real-credential round-trips are operator-owned (connector ledger).
 */

import {
  requirePostJson,
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";
import { signAwsRequest } from "./awsSigV4.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "access_key_id", label: "AWS access key ID", required: true, kind: "string" },
  { key: "secret_access_key", label: "AWS secret access key", required: true, kind: "secret" },
  { key: "region", label: "AWS region (e.g. us-east-1)", required: true, kind: "string" }
];

const SERVICE = "tagging";
const TARGET = "ResourceGroupsTaggingAPI_20170126.GetResources";

interface TagMapping {
  ResourceARN?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** ISO basic UTC stamp (YYYYMMDDTHHMMSSZ) from a Date. */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Human name from an ARN: the resource id (last ':' or '/' segment). */
function nameFromArn(arn: string): string {
  const tail = arn.split(":").pop() ?? arn;
  const seg = tail.includes("/") ? tail.split("/").pop() ?? tail : tail;
  return seg.length > 0 ? seg : arn;
}

export const awsAdapter: ConnectorAdapter = {
  id: "aws",
  displayName: "Amazon Web Services",
  status: "implemented",
  category: "cloud",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { access_key_id, secret_access_key, region } = config;
    if (!access_key_id || !secret_access_key || !region) {
      throw new Error("aws: incomplete config (validateConfig must pass first)");
    }
    const postJson = requirePostJson(http, "aws");
    const host = `${SERVICE}.${region}.amazonaws.com`;
    const url = `https://${host}/`;
    const payload = { ResourcesPerPage: 100 };
    // Sign the EXACT body string postJson will send (identical JSON.stringify).
    const body = JSON.stringify(payload);
    const stamp = amzDate(new Date());
    const signed = signAwsRequest({
      method: "POST",
      host,
      region,
      service: SERVICE,
      path: "/",
      body,
      accessKeyId: access_key_id,
      secretAccessKey: secret_access_key,
      amzDate: stamp,
      extraHeaders: { "x-amz-target": TARGET }
    });
    return postJson(
      url,
      {
        Authorization: signed.authorization,
        "X-Amz-Date": stamp,
        "X-Amz-Target": TARGET,
        "Content-Type": "application/x-amz-json-1.1",
        Accept: "application/json"
      },
      payload
    );
  },

  normalize(raw): NormalizedInventory {
    const list = (raw as { ResourceTagMappingList?: unknown } | null)?.ResourceTagMappingList;
    if (!Array.isArray(list)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const m of list as TagMapping[]) {
      const arn = str(m.ResourceARN);
      if (!arn || seen.has(arn)) continue;
      seen.add(arn);
      entities.push({ entity_type: "asset", name: nameFromArn(arn), external_ref: arn });
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
