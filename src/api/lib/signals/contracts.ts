/**
 * Four-stage signal contract — Priority 4 slice 4A.1 (contract stubs).
 *
 * Declares the typed seam the external-intelligence pipeline flows through:
 *
 *     RawSourceItem  ->  NormalizedSignal  ->  (EnrichedSignal)  ->  (BriefItem)
 *
 * This slice ships ONLY the first two stages plus the source discriminators
 * (`SourceKind` / `SourceDescriptor`), per the ratified plan
 * (`docs/roadmap/priority-4-implementation-plan.md` §10 decision 3):
 * `EnrichedSignal` and `BriefItem` are formalized incrementally in 4B/4C and
 * are deliberately NOT defined here.
 *
 * These are pure compile-time type declarations plus one schema-version
 * constant. Nothing in this module reads, writes, fetches, normalizes, dedups,
 * matches, or persists anything — it introduces no runtime behavior. It is not
 * yet wired into the registry, adapters, scheduler, or matcher; later slices
 * adopt it additively.
 *
 * Tenancy: these are GLOBAL signal-layer shapes. `cyber_signals` rows are
 * org-agnostic (`organization_id IS NULL`); per-org scoping happens downstream
 * at matcher fan-out time, never on these stages. Accordingly, neither
 * `RawSourceItem` nor `NormalizedSignal` carries an `organization_id`.
 */

import type { CyberSignalIngestInput } from "../cyberSignalValidation.js";

/**
 * Schema version stamped on each contract-stage payload so consumers can
 * detect shape drift as later slices (4B/4C/4D) extend the stages. Bump only
 * on a breaking change to a stage shape.
 */
export const CONTRACT_SCHEMA_VERSION = 1 as const;

/** Type of {@link CONTRACT_SCHEMA_VERSION}. */
export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;

/**
 * Adapter-family discriminator for a unified source registry (D4).
 *
 *   "rss" — feeds resolved through the RSS registry / `makeRssFeed` factory.
 *   "api" — the directly-wired API adapters (CISA KEV, NVD, SEC EDGAR,
 *           Federal Register, CISA alerts, MITRE ATT&CK/ATLAS).
 *
 * Superset of the registry-local `RegistryKind` (currently `"rss"` only) in
 * `feedAdapter/types.ts`; the registry is migrated onto this in a later slice.
 */
export type SourceKind = "rss" | "api";

/**
 * Minimal identity of an upstream source under the unified registry (D4).
 *
 * Stub shape for 4A.1 — only the stable id and the family discriminator. The
 * qualification fields (static authority / rolling reliability, D3) are added
 * additively in slice 4B and are intentionally absent here.
 */
export interface SourceDescriptor {
  /** Stable source identifier; also the `source` field on emitted signals. */
  readonly id: string;
  /** Adapter family that produced this source's items. */
  readonly kind: SourceKind;
}

/**
 * Stage 1 — a raw item as fetched from a source, before normalization.
 *
 * Carries the untouched source payload plus the provenance needed to trace it:
 * which source produced it, its family, and when it was fetched. The `raw`
 * field is deliberately untyped per source; downstream normalization (out of
 * scope for this slice) maps it to a {@link NormalizedSignal}.
 *
 * Global by construction — no `organization_id`.
 */
export interface RawSourceItem<TRaw = unknown> {
  /** Stage schema version. */
  readonly schemaVersion: ContractSchemaVersion;
  /** Id of the {@link SourceDescriptor} that produced this item. */
  readonly sourceId: string;
  /** Adapter family of the producing source. */
  readonly kind: SourceKind;
  /** ISO-8601 UTC timestamp of when the item was fetched. */
  readonly fetchedAt: string;
  /** The untouched source payload. */
  readonly raw: TRaw;
}

/**
 * Stage 2 — a normalized signal ready for ingestion into `cyber_signals`.
 *
 * Anchored to the existing {@link CyberSignalIngestInput} shape (the validated
 * ingest contract / `cyber_signals` row shape) so this stage stays the single
 * source of truth rather than a parallel definition. The only addition is the
 * stage {@link ContractSchemaVersion} stamp.
 *
 * Inherits {@link CyberSignalIngestInput}'s global shape — no `organization_id`.
 */
export type NormalizedSignal = CyberSignalIngestInput & {
  /** Stage schema version. */
  readonly schemaVersion: ContractSchemaVersion;
};
