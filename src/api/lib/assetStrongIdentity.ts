/**
 * assetStrongIdentity.ts — PLAT-ASSET-1: the strong-identity allowlist.
 *
 * PURE. No I/O, no database, no clock — the assetIdentity.ts /
 * severityNormalization.ts pattern: deterministic policy in code, total over
 * its input, unit-tested, explainable to a customer asking "why did the
 * platform create this asset on its own?".
 *
 * ── THE OPERATOR RULING THIS IMPLEMENTS (PLAT-ASSET-1, 2026-08-22) ─────────
 * Machines may make deterministic decisions; humans resolve ambiguity. A
 * source asset may automatically create a canonical asset ONLY when it
 * carries a sufficiently strong, PROVIDER-NATIVE, GLOBALLY UNIQUE identity.
 * No confidence score. No fuzzy matching. The allowlist is exact and lives
 * here, in one declaration.
 *
 * ── THE ALLOWLIST, AND WHY IT IS THIS SMALL ────────────────────────────────
 * Exactly one scheme qualifies: `cloud_resource_id`, and only when the value
 * parses under one of three provider-native grammars that are globally unique
 * BY THE PROVIDER'S OWN CONSTRUCTION:
 *
 *   aws    arn:partition:service:region:account:resource   (region/account
 *          may legitimately be empty — S3, IAM)
 *   azure  /subscriptions/{guid}/...                       (subscription GUID
 *          roots the path globally; ids are CASE-INSENSITIVE, so the
 *          normalized form is lowercase)
 *   gcp    //service.googleapis.com/...                    (full Cloud Asset
 *          name / self-link)
 *
 * These three forms are not speculation: they are exactly what this repo's
 * own aws/azure/gcp connectors emit as external_ref (connectors/aws.ts,
 * azure.ts, gcp.ts).
 *
 * Every other scheme is EXCLUDED from automatic creation, each for a reason
 * verified in this codebase (recorded in the PLAT-ASSET-1 package doc):
 *   instance_id       "unique within a provider account" (assetIdentity.ts) —
 *                     and no intake captures the account, so the namespace
 *                     that would make it unique is not established here;
 *   internal_id       the one-CMDB assumption is unenforced — `source` is
 *                     unregistered free text;
 *   scanner_asset_id  its (org, source) namespace key is free text by ruling
 *                     (20261035), so the namespace itself can fork; and a
 *                     scanner id alone would create the placeholder host the
 *                     importer refuses on principle;
 *   fqdn / hostname   operator-excluded weak identifiers (two `web01`s in two
 *                     domains is ordinary — 20261033 header);
 *   application_id    no producer, no registry namespace;
 *   ip / mac          volatile — never even resolution keys.
 *
 * A `cloud_resource_id` value that parses under NO grammar (a bare
 * `i-0abc123`, a scanner's freeform label) is `unqualified`: it must not
 * auto-create, and the caller routes it to the human review queue.
 *
 * ── WHY GRAMMARS INSIDE ONE SCHEME, NOT NEW SCHEMES ────────────────────────
 * Dedicated `aws_arn`/`azure_resource_id` schemes were considered and
 * rejected (architect ruling): three producer lanes already speak
 * `cloud_resource_id`, new schemes would make every producer classify the
 * provider before choosing a scheme (and a producer that cannot classify
 * falls back to `cloud_resource_id`, silently defeating the strong path),
 * and the uniqueness property is per-GRAMMAR, not per-scheme — an 'other'
 * provider's value inside a dedicated scheme would still need this parser.
 * Heterogeneity is handled where heterogeneity belongs: one pure, total,
 * unit-tested classifier.
 */

/** The scheme that can qualify. Mirrors one value of the 20261033 CHECK. */
export const STRONG_IDENTITY_SCHEME = "cloud_resource_id";

export interface StrongIdentity {
  provider: "aws" | "azure" | "gcp";
  /**
   * The canonical stored form. For Azure this is the lowercased id (ARM ids
   * are case-insensitive — without folding, /subscriptions/ABC… and
   * /subscriptions/abc… would become two assets). AWS and GCP values are
   * case-sensitive and kept verbatim (trimmed).
   */
  normalizedValue: string;
  /** AWS account id / Azure subscription GUID / GCP project id — when the
   *  grammar carries one. Absence is legal (S3/IAM ARNs). */
  accountId: string | null;
  /** Region when the identifier carries one; ARM ids and many ARNs do not. */
  region: string | null;
  /** Provider-native type: ARN service, ARM provider/type pair, GCP service
   *  host. Free-text detail, not load-bearing. */
  resourceType: string | null;
  /** Human-legible short name — the last path/colon segment, mirroring the
   *  AWS connector's nameFromArn so both creation lanes name alike. */
  derivedName: string;
}

/**
 * AWS ARN: arn:partition:service:region:account:resource
 * region and account may be EMPTY (arn:aws:s3:::bucket, IAM role ARNs) —
 * the grammar must tolerate every legal shape or real ARNs flood the review
 * queue. resource must be non-empty. Case-sensitive (resource part is).
 */
const AWS_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):([a-z0-9-]+):([a-z0-9-]*):(\d{12}|):(.+)$/;

/**
 * Azure ARM resource id: /subscriptions/{guid}[/resourceGroups/{rg}]
 * [/providers/{ns}/{type}/{name}[...]]. GUID validated strictly; anything
 * after it is a path of non-empty segments. Compared case-insensitively.
 */
const AZURE_ID =
  /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[^/]+)*$/i;

const AZURE_SUBSCRIPTION = /^\/subscriptions\/([0-9a-f-]{36})/i;
const AZURE_PROVIDER_TYPE = /\/providers\/([^/]+\/[^/]+)/i;

/**
 * GCP full asset name / self-link: //service.googleapis.com/path…
 * (Cloud Asset Inventory form, exactly what connectors/gcp.ts emits).
 * Case-sensitive.
 */
const GCP_NAME = /^\/\/[a-z][a-z0-9.-]*\.googleapis\.com\/.+$/;

const GCP_PROJECT = /\/projects\/([^/]+)/;
const GCP_SERVICE = /^\/\/([a-z][a-z0-9.-]*\.googleapis\.com)\//;

/** Last ':'-then-'/' segment — the AWS connector's nameFromArn, generalized. */
function lastSegment(value: string): string {
  const tail = value.split(":").pop() ?? value;
  const seg = tail.includes("/") ? (tail.split("/").pop() ?? tail) : tail;
  return seg.length > 0 ? seg : value;
}

/**
 * Classify one identifier claim against the allowlist. Total: every input
 * returns either a fully-parsed StrongIdentity or null (= not qualified for
 * automatic creation — which is a routing decision, never an error).
 */
export function classifyStrongIdentity(
  scheme: string,
  rawValue: string
): StrongIdentity | null {
  if (scheme !== STRONG_IDENTITY_SCHEME) return null;
  const value = rawValue.trim();
  if (value.length === 0) return null;

  const arn = AWS_ARN.exec(value);
  if (arn !== null) {
    return {
      provider: "aws",
      normalizedValue: value,
      accountId: arn[4] === "" ? null : arn[4]!,
      region: arn[3] === "" ? null : arn[3]!,
      resourceType: arn[2]!,
      derivedName: lastSegment(value)
    };
  }

  if (AZURE_ID.test(value)) {
    const normalized = value.toLowerCase();
    const sub = AZURE_SUBSCRIPTION.exec(normalized);
    const providerType = AZURE_PROVIDER_TYPE.exec(normalized);
    return {
      provider: "azure",
      normalizedValue: normalized,
      accountId: sub?.[1] ?? null,
      region: null,
      resourceType: providerType?.[1] ?? null,
      derivedName: lastSegment(normalized)
    };
  }

  if (GCP_NAME.test(value)) {
    return {
      provider: "gcp",
      normalizedValue: value,
      accountId: GCP_PROJECT.exec(value)?.[1] ?? null,
      region: null,
      resourceType: GCP_SERVICE.exec(value)?.[1] ?? null,
      derivedName: lastSegment(value)
    };
  }

  return null;
}
