/**
 * API-source descriptors — Priority 4 slice A3 (metadata-only).
 *
 * Registers the seven directly-wired API adapters as `kind:'api'`
 * {@link SourceDescriptor}s under the unified source-registry contract
 * (`./contracts.ts`). This is the `api` half of the eventual unified registry;
 * the `rss` half already carries `kind:'rss'` in `feedAdapter/registry.ts`.
 *
 * SCOPE — this slice ships DATA ONLY. Nothing consumes `API_SOURCES` yet:
 *   - `briefScheduler.ts` still imports and calls each adapter's fetch function
 *     directly and is deliberately NOT rewired here.
 *   - Routing the scheduler (and the other fan-out paths) THROUGH this registry
 *     is the deferred fan-out/resolution-unification work (Priority 4 EPIC A4).
 * Because no runtime path imports this module, it introduces no behavior change:
 * no fetch, ingestion, normalization, dedup, clustering, qualification,
 * matching, or persistence happens here.
 *
 * The `id` of each descriptor is the canonical source id already used by the
 * scheduler's `feed_health` calls (`recordFeedSuccess`/`recordFeedFailure`) and
 * its per-source counters, so the eventual A4 unification lines up id-for-id.
 *
 * Tenancy: these are GLOBAL signal-layer shapes — no `organization_id`. Per-org
 * scoping happens downstream at matcher fan-out, never on a source descriptor.
 */

import type { SourceDescriptor } from "./contracts.js";

/**
 * The seven directly-wired API adapters, in scheduler invocation order. Each id
 * matches the `feed_health` source id the scheduler already records.
 *
 *   cisa_kev        — CISA Known Exploited Vulnerabilities catalog
 *   nvd             — NIST National Vulnerability Database (recent CVEs)
 *   sec_edgar       — SEC EDGAR 8-K Item 1.05 cyber disclosures
 *   federal_register— Federal Register regulatory documents
 *   cisa_alerts     — CISA cybersecurity alerts/advisories
 *   mitre_attack    — MITRE ATT&CK techniques + threat groups (STIX)
 *   mitre_atlas     — MITRE ATLAS adversarial-ML tactics/techniques
 */
export const API_SOURCES: readonly SourceDescriptor[] = [
  { id: "cisa_kev", kind: "api" },
  { id: "nvd", kind: "api" },
  { id: "sec_edgar", kind: "api" },
  { id: "federal_register", kind: "api" },
  { id: "cisa_alerts", kind: "api" },
  { id: "mitre_attack", kind: "api" },
  { id: "mitre_atlas", kind: "api" }
] as const;
