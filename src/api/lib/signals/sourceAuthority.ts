/**
 * Static source-authority annotations — Priority 4 / Phase 4B / slice B2.
 *
 * The CANONICAL source of truth for each upstream source's STATIC authority:
 *   - `authority`     — a controlled category (who publishes it / what kind of
 *                       organization), see {@link SourceAuthority}.
 *   - `authorityTier` — a 1–5 ordinal (1 = most authoritative) matching the
 *                       `sources.authority_tier` CHECK (1..5).
 *
 * "Static" = editorially assigned, slow-moving. The COMPLEMENTARY rolling
 * `reliability` (derived from `feed_health` success/failure history) is slice
 * B3 and lives only in the `sources` table — it is intentionally absent here.
 *
 * SINGLE SOURCE OF TRUTH: these values are mirrored into the additive seed
 * migration `db/migrations/20260708_sources_authority.sql`. Nothing keeps the
 * hand-written SQL and this map in sync at runtime, so
 * `src/api/__tests__/signals/sourceAuthorityTable.test.ts` fails loudly on any
 * drift (missing source, out-of-bounds tier, value mismatch, typo'd id that
 * would make the UPDATE silently no-op).
 *
 * SCOPE — B2 ships DATA ONLY. Nothing consumes this map yet: ranking that reads
 * qualification is slice B4, behind `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED`,
 * and reads from the `sources` TABLE (the durable store), not from this module.
 * No fetch, ingestion, normalization, dedup, clustering, matching, scheduling,
 * or brief behavior changes here.
 *
 * Tenancy: GLOBAL signal-layer metadata — no `organization_id`. A source's
 * authority is shared across all orgs, the same posture as `feed_health` and
 * the `sources` table.
 *
 * Keys are the canonical source ids used by `feed_health.source`, the registry
 * `SourceDescriptor.id` (API_SOURCES + FEEDS), and the `sources` table PK.
 */

/**
 * Controlled authority categories. Mirrored by the `sources_authority_vocab_check`
 * CHECK constraint in the B2 migration — keep the two in lockstep.
 *
 *   government     — official government / regulator publications (CISA, SEC,
 *                    Federal Register, FTC, NIST news, ONC).
 *   standards_body — standards / catalog authorities (NIST NVD).
 *   research       — recognized research / knowledge-base authorities (MITRE
 *                    ATT&CK / ATLAS, SANS ISC).
 *   security_press — curated security journalism (BleepingComputer, Krebs).
 */
export type SourceAuthority =
  | "government"
  | "standards_body"
  | "research"
  | "security_press";

/** Static authority annotation for one source. */
export interface SourceAuthorityRecord {
  readonly authority: SourceAuthority;
  /** 1 = most authoritative … 5 = least. Matches `sources.authority_tier` (1..5). */
  readonly authorityTier: 1 | 2 | 3 | 4 | 5;
}

/**
 * Static authority for all 13 known sources (7 api + 6 rss), keyed by canonical
 * source id. The mirror of record for the B2 seed migration.
 */
export const SOURCE_AUTHORITY: Readonly<Record<string, SourceAuthorityRecord>> = {
  // ── API sources (7) ───────────────────────────────────────────────────
  cisa_kev: { authority: "government", authorityTier: 1 },
  cisa_alerts: { authority: "government", authorityTier: 1 },
  federal_register: { authority: "government", authorityTier: 1 },
  sec_edgar: { authority: "government", authorityTier: 1 },
  nvd: { authority: "standards_body", authorityTier: 1 },
  mitre_attack: { authority: "research", authorityTier: 2 },
  mitre_atlas: { authority: "research", authorityTier: 2 },

  // ── RSS sources (6) ───────────────────────────────────────────────────
  nist_news: { authority: "government", authorityTier: 1 },
  ftc_news: { authority: "government", authorityTier: 1 },
  onc_healthit: { authority: "government", authorityTier: 1 },
  sans_isc: { authority: "research", authorityTier: 2 },
  krebsonsecurity: { authority: "security_press", authorityTier: 3 },
  bleepingcomputer: { authority: "security_press", authorityTier: 3 }
} as const;
