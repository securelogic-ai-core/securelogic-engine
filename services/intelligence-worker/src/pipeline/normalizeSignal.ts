import { Signal } from "../models/Signal.js";
import { SignalIngestedEvent } from "../types/events.js";
import { classifyCategory } from "./classifyCategory.js";

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/i;

const KNOWN_VENDORS = [
  "microsoft", "google", "apple", "amazon", "meta", "cisco", "palo alto",
  "crowdstrike", "sentinelone", "fortinet", "checkpoint", "juniper",
  "vmware", "broadcom", "ibm", "oracle", "sap", "salesforce", "servicenow",
  "okta", "ping identity", "cyberark", "beyond trust", "delinea",
  "qualys", "tenable", "rapid7", "veracode", "snyk", "sonatype",
  "splunk", "elastic", "datadog", "sumo logic", "logrhythm",
  "ivanti", "citrix", "f5", "barracuda", "sophos", "trend micro",
  "symantec", "mcafee", "kaspersky", "bitdefender", "eset",
  "cloudflare", "akamai", "zscaler", "netskope", "wiz", "lacework",
  "github", "gitlab", "atlassian", "slack", "zoom", "openai", "anthropic",
];

export function extractCve(text: string): string | null {
  const match = text.match(CVE_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

export function extractVendor(text: string): string | null {
  const lower = text.toLowerCase();
  for (const vendor of KNOWN_VENDORS) {
    if (lower.includes(vendor)) {
      // Return title-cased version of the matched vendor
      return vendor.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
}

export function normalizeSignal(event: SignalIngestedEvent): Signal {
  const raw =
    typeof event.payload === "string"
      ? event.payload
      : JSON.stringify(event.payload);

  const classification = classifyCategory(event.title, raw);
  const fullText = `${event.title} ${raw}`;

  return {
    id: event.signalId,
    title: event.title,
    source: event.source,
    url: event.url,
    category: classification.primary,
    categories: classification.all,
    categoryReason: classification.reason,
    summary: raw.slice(0, 2000),
    rawContent: raw,
    affectedCve: extractCve(fullText),
    affectedVendor: extractVendor(fullText),
    tags: [],
    timestamp: event.timestamp,
    processed: false
  };
}
