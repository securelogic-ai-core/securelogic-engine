/**
 * cyberSignals.ts — Cyber signal ingestion and read API
 *
 * Cyber signals are external security events ingested from any source
 * (CISA KEV, NVD, RSS feeds, manual entry, mock/seed data). The architecture
 * is source-agnostic: the source field identifies the adapter but the DB
 * schema and processing pipeline are identical for all sources.
 *
 * INGEST PIPELINE (POST)
 * ----------------------
 *  1. Validate input (cyberSignalValidation)
 *  2. Normalize + compute dedup_hash (cyberSignalNormalizer)
 *  3. INSERT signal — ON CONFLICT (org, dedup_hash) DO NOTHING:
 *       new signal  → inserted, then processed
 *       duplicate   → existing row returned, processing skipped
 *  4. Process: vendor/AI system matching, finding creation, risk exposure
 *     flagging, posture snapshot trigger (cyberSignalProcessingService)
 *
 * DEDUPLICATION
 * -------------
 * The dedup_hash is a SHA-256 of source|signal_type|affected_cve|affected_vendor
 * (all lowercased). It is unique per organization — two orgs can both ingest
 * the same CVE. The unique constraint is (organization_id, dedup_hash).
 *
 * FINDING CREATION RULE
 * ---------------------
 * A finding with source_type = 'cyber_signal' is created ONLY when the signal's
 * affected_vendor matches a known vendor or AI system in the platform. Signals
 * with no entity match are stored and marked processed but produce no finding.
 *
 * Routes:
 *   POST  /api/cyber-signals          — ingest a signal (normalize + dedup + process)
 *   GET   /api/cyber-signals          — list for org (cursor paginated)
 *   GET   /api/cyber-signals/:id      — get single signal with linked finding
 *   POST  /api/cyber-signals/:id/reprocess — re-run processing on an existing signal
 *
 * Constraints:
 *   - All routes are org-scoped via requireApiKey + attachOrganizationContext.
 *   - No DELETE route.
 *   - No bulk ingest endpoint (ingest one signal per request for clarity).
 *   - All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateCyberSignalIngest } from "../lib/cyberSignalValidation.js";
import { normalizeSignal } from "../lib/cyberSignalNormalizer.js";
import { processSignal, type CyberSignalRecord } from "../lib/cyberSignalProcessingService.js";
import { fetchCisaKevSignals } from "../lib/cisaKevAdapter.js";
import { fetchNvdSignals } from "../lib/nvdAdapter.js";
import { fetchSecEdgarSignals } from "../lib/secEdgarAdapter.js";
import { fetchFederalRegisterSignals } from "../lib/federalRegisterAdapter.js";
import { fetchCisaAlerts } from "../lib/cisaAlertsAdapter.js";
import {
  fetchAllFeeds,
  THREAT_INTEL_FEED_IDS,
  REGULATORY_FEED_IDS
} from "../lib/feedAdapter/index.js";
import { fetchMitreAttackSignals } from "../lib/mitreAttackAdapter.js";
import { fetchMitreAtlasSignals } from "../lib/mitreAtlasAdapter.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { encryptField } from "../lib/fieldEncryption.js";
import { getSourceDisplayName } from "../lib/sourceDisplayNames.js";

/**
 * Add `source_display` to a signal row read from the DB. The display name is
 * derived from `source` at response time so renames don't require a backfill.
 */
function withSourceDisplay<T extends { source: string }>(
  signal: T
): T & { source_display: string } {
  return { ...signal, source_display: getSourceDisplayName(signal.source) };
}

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

const VALID_STATUS_FILTERS = new Set(["processed", "unprocessed"]);

const SIGNAL_SELECT = `
  id,
  organization_id,
  source,
  signal_type,
  severity,
  normalized_summary,
  affected_vendor,
  affected_cve,
  dedup_hash,
  ingestion_timestamp,
  processed,
  linked_finding_id,
  created_at,
  updated_at
`;

const FINDING_SELECT = `
  id,
  organization_id,
  assessment_id,
  source_type,
  source_id,
  title,
  description,
  severity,
  domain,
  priority,
  status,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/cyber-signals
   Ingest a raw cyber signal.

   1. Validate and normalize the input.
   2. Insert with dedup guard (ON CONFLICT DO NOTHING).
   3. If new: run processing (vendor match → finding → risk flag → posture).
   4. Return signal + processing results.

   A 409 is returned if the signal is a duplicate (already ingested by
   this org). The existing signal record is returned alongside the error
   so callers can inspect what was previously stored.
   ========================================================= */

router.post(
  "/cyber-signals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateCyberSignalIngest(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const normalized = normalizeSignal(validated.input);

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Insert the signal. ON CONFLICT (org, dedup_hash) DO NOTHING means
      // a duplicate returns rowCount = 0 and no row in the result set.
      const insertResult = await client.query(
        `
        INSERT INTO cyber_signals (
          organization_id,
          source,
          signal_type,
          severity,
          raw_payload,
          normalized_summary,
          affected_vendor,
          affected_cve,
          dedup_hash,
          external_id,
          ingestion_timestamp,
          processed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
        ON CONFLICT (organization_id, dedup_hash) DO NOTHING
        RETURNING ${SIGNAL_SELECT}
        `,
        [
          organizationId,
          normalized.source,
          normalized.signal_type,
          normalized.severity,
          JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
          normalized.normalized_summary,
          normalized.affected_vendor,
          normalized.affected_cve,
          normalized.dedup_hash,
          normalized.external_id
        ]
      );

      const isDuplicate = (insertResult.rowCount ?? 0) === 0;

      if (isDuplicate) {
        // Return the existing record so the caller can see what is stored.
        const existingResult = await client.query(
          `
          SELECT ${SIGNAL_SELECT}
          FROM cyber_signals
          WHERE organization_id = $1
            AND dedup_hash = $2
          LIMIT 1
          `,
          [organizationId, normalized.dedup_hash]
        );

        await client.query("COMMIT");

        logger.info(
          {
            event: "cyber_signal_duplicate_rejected",
            organizationId,
            source: normalized.source,
            signalType: normalized.signal_type,
            dedupHash: normalized.dedup_hash
          },
          "Duplicate cyber signal rejected"
        );

        res.status(409).json({
          error: "duplicate_signal",
          message: "This signal has already been ingested by your organization.",
          signal: existingResult.rows[0] ?? null
        });
        return;
      }

      const signal = insertResult.rows[0];
      await client.query("COMMIT");

      logger.info(
        {
          event: "cyber_signal_ingested",
          organizationId,
          signalId: signal.id,
          source: normalized.source,
          signalType: normalized.signal_type,
          severity: normalized.severity,
          affectedVendor: normalized.affected_vendor,
          affectedCve: normalized.affected_cve
        },
        "Cyber signal ingested"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: null,
        eventType: "cyber_signal.ingested",
        resourceType: "cyber_signal",
        resourceId: signal.id,
        payload: {
          source: normalized.source,
          signal_type: normalized.signal_type,
          severity: normalized.severity,
          affected_vendor: normalized.affected_vendor,
          affected_cve: normalized.affected_cve
        },
        ipAddress: req.ip ?? null
      });

      // Run processing asynchronously from the DB insert so the signal row
      // is fully committed before vendor matching queries run.
      const signalRecord: CyberSignalRecord = {
        id: signal.id,
        organization_id: organizationId,
        source: signal.source,
        signal_type: signal.signal_type,
        severity: signal.severity,
        normalized_summary: signal.normalized_summary,
        affected_vendor: signal.affected_vendor,
        affected_cve: signal.affected_cve
      };

      const processingResult = await processSignal(signalRecord);

      // Re-fetch the signal to pick up processed=true + linked_finding_id.
      const refreshedResult = await pg.query(
        `
        SELECT ${SIGNAL_SELECT}
        FROM cyber_signals
        WHERE id = $1
          AND organization_id = $2
        `,
        [signal.id, organizationId]
      );

      res.status(201).json({
        signal: refreshedResult.rows[0] ?? signal,
        finding: processingResult.finding,
        matchedVendorId: processingResult.matched_vendor_id,
        matchedAiSystemId: processingResult.matched_ai_system_id,
        risksFlagged: processingResult.risks_flagged,
        postureRecalculated: processingResult.posture_recalculated,
        wasDuplicate: false
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "cyber_signal_ingest_failed", err },
        "POST /api/cyber-signals failed"
      );
      res.status(500).json({ error: "cyber_signal_ingest_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/cyber-signals
   List cyber signals for the requesting organization.

   Query params:
     limit            — max results per page (default 25, max 100)
     before_created_at / before_id — cursor pagination
     signal_type      — filter by signal_type
     processed        — "processed" | "unprocessed"
     severity         — filter by severity
   ========================================================= */

router.get(
  "/cyber-signals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = isNonEmptyString(req.query.before_created_at)
        ? req.query.before_created_at
        : null;
      const beforeId = isNonEmptyString(req.query.before_id)
        ? req.query.before_id
        : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      // signal_type filter
      const filterSignalType = isNonEmptyString(req.query.signal_type)
        ? req.query.signal_type.trim()
        : null;
      if (filterSignalType !== null) {
        params.push(filterSignalType);
        conditions.push(`signal_type = $${params.length}`);
      }

      // processed filter
      const filterProcessed = isNonEmptyString(req.query.processed)
        ? req.query.processed.trim()
        : null;
      if (filterProcessed !== null) {
        if (!VALID_STATUS_FILTERS.has(filterProcessed)) {
          res.status(400).json({
            error: "invalid_processed_filter",
            message: "must be 'processed' or 'unprocessed'"
          });
          return;
        }
        params.push(filterProcessed === "processed");
        conditions.push(`processed = $${params.length}`);
      }

      // severity filter
      const filterSeverity = isNonEmptyString(req.query.severity)
        ? req.query.severity.trim()
        : null;
      if (filterSeverity !== null) {
        params.push(filterSeverity);
        conditions.push(`severity = $${params.length}`);
      }

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }

        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await pg.query(
        `
        SELECT ${SIGNAL_SELECT}
        FROM cyber_signals
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const rawSignals = result.rows;
      const last = rawSignals.length > 0 ? rawSignals[rawSignals.length - 1] : null;
      const signals = rawSignals.map(withSourceDisplay);

      res.status(200).json({
        count: signals.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        signals
      });
    } catch (err) {
      logger.error(
        { event: "cyber_signals_list_failed", err },
        "GET /api/cyber-signals failed"
      );
      res.status(500).json({ error: "cyber_signals_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/cyber-signals/:id
   Get a single cyber signal with its linked finding (if any).
   Returns 404 if the signal does not belong to this org.
   ========================================================= */

router.get(
  "/cyber-signals/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const signalId = String(req.params.id ?? "").trim();
    if (!signalId) {
      res.status(400).json({ error: "signal_id_required" });
      return;
    }
    if (!isUuid(signalId)) {
      res.status(400).json({ error: "signal_id_must_be_uuid" });
      return;
    }

    try {
      const signalResult = await pg.query(
        `
        SELECT ${SIGNAL_SELECT}
        FROM cyber_signals
        WHERE id = $1
          AND organization_id = $2
        `,
        [signalId, organizationId]
      );

      if ((signalResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "cyber_signal_not_found" });
        return;
      }

      const signal = withSourceDisplay(signalResult.rows[0]);

      // Fetch the linked finding if one exists. Use source_type + source_id
      // rather than linked_finding_id to stay consistent with the platform
      // polymorphic finding lookup convention.
      const findingResult = await pg.query(
        `
        SELECT ${FINDING_SELECT}
        FROM findings
        WHERE organization_id = $1
          AND source_type = 'cyber_signal'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        `,
        [organizationId, signalId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ signal, finding });
    } catch (err) {
      logger.error(
        { event: "cyber_signal_get_failed", err },
        "GET /api/cyber-signals/:id failed"
      );
      res.status(500).json({ error: "cyber_signal_get_failed" });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/cisa-kev
   Pull the live CISA KEV feed and ingest new signals for this org.

   Iterates the full KEV catalog and runs each entry through the standard
   ingest pipeline (validate → normalize → deduplicate → process). Entries
   already present for this org are skipped via the dedup hash constraint.

   Returns a summary:
     { fetched, inserted, skipped_duplicate, skipped_invalid, errors }

   The route is defined before the /:id/reprocess parametric route so that
   Express does not match "fetch" as a signal UUID.

   Rate note: the CISA KEV catalog is ~1,000+ entries. Each new signal triggers
   processSignal() (vendor match + posture update). On first run this will be
   slow. Subsequent runs are fast because nearly all entries are duplicates.
   ========================================================= */

router.post(
  "/cyber-signals/fetch/cisa-kev",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      const { signals, total, skipped: skippedMapping } = await fetchCisaKevSignals();

      fetched = total;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        // Re-validate through the canonical validator so every signal passes
        // the same constraints as a manual POST to /api/cyber-signals.
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              dedup_hash,
              external_id,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          // Run the processing pipeline (vendor match → finding → risk flag → posture).
          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "cisa_kev_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          errorCount: errors.length
        },
        "CISA KEV fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "cisa_kev_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/cisa-kev failed"
      );
      res.status(502).json({
        error: "cisa_kev_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching CISA KEV feed"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/nvd
   Pull recent CVEs from the NVD API and ingest new signals for this org.

   Query params:
     days — look-back window in days (default 7, max 30)

   Each CVE runs through the standard ingest pipeline:
     validate → normalize → deduplicate → process
   CVEs already present for this org are skipped via dedup hash.

   NVD RATE LIMITING
   -----------------
   Without NVD_API_KEY: 5 requests per 30 seconds.
   With NVD_API_KEY env var: 50 requests per 30 seconds.
   The adapter applies a 600ms inter-page delay for paginated fetches.
   For large date windows, set NVD_API_KEY to avoid rate limit errors.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid,
              pages_fetched, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/nvd",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Parse and clamp the days parameter.
    const rawDays = parseInt(String(req.query.days ?? "7"), 10);
    const windowDays = !Number.isFinite(rawDays) || rawDays < 1
      ? 7
      : Math.min(rawDays, 30);

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    let pagesFetched = 0;
    const errors: string[] = [];

    try {
      const {
        signals,
        total,
        pages,
        skipped: skippedMapping
      } = await fetchNvdSignals(windowDays);

      fetched = total;
      pagesFetched = pages;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              dedup_hash,
              external_id,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "nvd_fetch_complete",
          organizationId,
          windowDays,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          pagesFetched,
          errorCount: errors.length
        },
        "NVD fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        pages_fetched: pagesFetched,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "nvd_fetch_failed", organizationId, windowDays, err },
        "POST /api/cyber-signals/fetch/nvd failed"
      );
      res.status(502).json({
        error: "nvd_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching NVD CVE data"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/sec-edgar
   Pull SEC EDGAR 8-K Item 1.05 (Material Cybersecurity Incident) filings and
   ingest each as a third_party_breach signal keyed on the filer company name.

   Mirrors /fetch/nvd. EDGAR-specific: external_id (the accession number) is
   persisted — it is the dedup discriminator that keeps two 8-Ks from the same
   filer distinct (NVD leaves external_id null).

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/sec-edgar",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Parse and clamp the days parameter.
    const rawDays = parseInt(String(req.query.days ?? "7"), 10);
    const windowDays = !Number.isFinite(rawDays) || rawDays < 1
      ? 7
      : Math.min(rawDays, 30);

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    let pagesFetched = 0;
    const errors: string[] = [];

    try {
      const {
        signals,
        total,
        pages,
        skipped: skippedMapping
      } = await fetchSecEdgarSignals(windowDays);

      fetched = total;
      pagesFetched = pages;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              external_id,
              dedup_hash,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.external_id,
              normalized.dedup_hash
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "sec_edgar_fetch_complete",
          organizationId,
          windowDays,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          pagesFetched,
          errorCount: errors.length
        },
        "SEC EDGAR fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        pages_fetched: pagesFetched,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "sec_edgar_fetch_failed", organizationId, windowDays, err },
        "POST /api/cyber-signals/fetch/sec-edgar failed"
      );
      res.status(502).json({
        error: "sec_edgar_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching SEC EDGAR data"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/federal-register
   Pull Federal Register cyber/privacy final + proposed rules and
   ingest each as a regulatory_change signal (obligation-branch matching).

   Mirrors /fetch/sec-edgar. external_id (the FR document number) is
   persisted — it is the dedup discriminator that keeps two 8-Ks from the same
   document distinct.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/federal-register",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Parse and clamp the days parameter.
    const rawDays = parseInt(String(req.query.days ?? "7"), 10);
    const windowDays = !Number.isFinite(rawDays) || rawDays < 1
      ? 7
      : Math.min(rawDays, 30);

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    let pagesFetched = 0;
    const errors: string[] = [];

    try {
      const {
        signals,
        total,
        pages,
        skipped: skippedMapping
      } = await fetchFederalRegisterSignals(windowDays);

      fetched = total;
      pagesFetched = pages;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              external_id,
              dedup_hash,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.external_id,
              normalized.dedup_hash
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "federal_register_fetch_complete",
          organizationId,
          windowDays,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          pagesFetched,
          errorCount: errors.length
        },
        "SEC EDGAR fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        pages_fetched: pagesFetched,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "federal_register_fetch_failed", organizationId, windowDays, err },
        "POST /api/cyber-signals/fetch/federal-register failed"
      );
      res.status(502).json({
        error: "federal_register_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching Federal Register data"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/cisa-alerts
   Pull CISA cybersecurity advisories RSS feed and ingest new signals.

   Covers CISA's advisory surface beyond the KEV catalog: ICS advisories,
   nation-state alerts, ransomware guidance, and critical infrastructure
   bulletins. Signals are typed as 'threat_actor' or 'patch_advisory'.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/cisa-alerts",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      const { signals, total, skipped: skippedMapping } = await fetchCisaAlerts();

      fetched = total;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `INSERT INTO cyber_signals (
               organization_id, source, signal_type, severity, raw_payload,
               normalized_summary, affected_vendor, affected_cve,
               dedup_hash,
               external_id, ingestion_timestamp, processed
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
             ON CONFLICT (organization_id, dedup_hash) DO NOTHING
             RETURNING id, source, signal_type, severity, normalized_summary,
                       affected_vendor, affected_cve, organization_id`,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try { await client.query("ROLLBACK"); } catch { /* ignore */ }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "cisa_alerts_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          errorCount: errors.length
        },
        "CISA Alerts fetch complete"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: null,
        eventType: "cyber_signal.batch_ingested",
        resourceType: "cyber_signal",
        payload: { source: "cisa_alerts", fetched, inserted, skippedDuplicate },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "cisa_alerts_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/cisa-alerts failed"
      );
      res.status(502).json({
        error: "cisa_alerts_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching CISA Alerts feed"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/threat-intel-rss
   Fetch threat intelligence RSS feeds from BleepingComputer,
   Krebs on Security, and SANS ISC.

   Request body (optional):
     { sources?: string[] }  — subset of ['bleepingcomputer',
                               'krebsonsecurity', 'sans_isc'].
                               Defaults to all three.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid,
              source_results, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/threat-intel-rss",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Parse optional sources filter from request body.
    const body =
      req.body != null && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    let requestedSources: string[] | undefined;
    if ("sources" in body && Array.isArray(body.sources)) {
      const filtered = (body.sources as unknown[])
        .filter((s): s is string => typeof s === "string" && THREAT_INTEL_FEED_IDS.has(s));
      requestedSources = filtered.length > 0 ? filtered : undefined;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      // Scope the run to the threat-intel feeds. If the caller supplied a
      // `sources` array, narrow further; otherwise fan out to all three.
      const ids = requestedSources ?? [...THREAT_INTEL_FEED_IDS];
      const { signals, results: sourceResults } = await fetchAllFeeds({ ids });

      fetched = signals.length;

      // Collect per-source fetch errors
      for (const [src, r] of Object.entries(sourceResults)) {
        if (r.error) {
          errors.push(`fetch_failed[${src}]: ${r.error}`);
        }
      }

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `INSERT INTO cyber_signals (
               organization_id, source, signal_type, severity, raw_payload,
               normalized_summary, affected_vendor, affected_cve,
               dedup_hash,
               external_id, ingestion_timestamp, processed
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
             ON CONFLICT (organization_id, dedup_hash) DO NOTHING
             RETURNING id, source, signal_type, severity, normalized_summary,
                       affected_vendor, affected_cve, organization_id`,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try { await client.query("ROLLBACK"); } catch { /* ignore */ }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "threat_intel_rss_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          sourceResults,
          errorCount: errors.length
        },
        "Threat intel RSS fetch complete"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: null,
        eventType: "cyber_signal.batch_ingested",
        resourceType: "cyber_signal",
        payload: { source: "threat_intel_rss", fetched, inserted, skippedDuplicate },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        source_results: sourceResults,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "threat_intel_rss_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/threat-intel-rss failed"
      );
      res.status(502).json({
        error: "threat_intel_rss_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching threat intel feeds"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/regulatory
   Fetch regulatory news feeds from NIST and FTC.

   Only items matching cybersecurity relevance keywords are ingested.
   All signals are typed 'regulatory_change'.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid,
              source_results, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/regulatory",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      const { signals, results: sourceResults } = await fetchAllFeeds({
        ids: [...REGULATORY_FEED_IDS]
      });

      fetched = signals.length;

      for (const [src, r] of Object.entries(sourceResults)) {
        if (r.error) {
          errors.push(`fetch_failed[${src}]: ${r.error}`);
        }
      }

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `INSERT INTO cyber_signals (
               organization_id, source, signal_type, severity, raw_payload,
               normalized_summary, affected_vendor, affected_cve,
               dedup_hash,
               external_id, ingestion_timestamp, processed
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
             ON CONFLICT (organization_id, dedup_hash) DO NOTHING
             RETURNING id, source, signal_type, severity, normalized_summary,
                       affected_vendor, affected_cve, organization_id`,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try { await client.query("ROLLBACK"); } catch { /* ignore */ }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "regulatory_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          sourceResults,
          errorCount: errors.length
        },
        "Regulatory feed fetch complete"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: null,
        eventType: "cyber_signal.batch_ingested",
        resourceType: "cyber_signal",
        payload: { source: "regulatory", fetched, inserted, skippedDuplicate },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        source_results: sourceResults,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "regulatory_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/regulatory failed"
      );
      res.status(502).json({
        error: "regulatory_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching regulatory feeds"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/mitre-attack
   Fetch the MITRE ATT&CK Enterprise STIX bundle and ingest new signals.

   Extracts attack-pattern (techniques), intrusion-set (threat groups),
   malware, and tool objects from the enterprise-attack STIX 2.1 bundle.
   Deprecated and revoked objects are skipped automatically.

   First run ingests several hundred signals (all active ATT&CK objects).
   Subsequent runs are fast — nearly all objects resolve to duplicates via
   the SHA-256 dedup hash keyed on (source, signal_type, attack_id).

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/mitre-attack",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      const { signals, total, skipped: skippedMapping } = await fetchMitreAttackSignals();

      fetched = total;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              dedup_hash,
              external_id,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "mitre_attack_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          errorCount: errors.length
        },
        "MITRE ATT&CK fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "mitre_attack_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/mitre-attack failed"
      );
      res.status(502).json({
        error: "mitre_attack_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching MITRE ATT&CK data"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/fetch/mitre-atlas
   Fetch the MITRE ATLAS AI-specific attack technique bundle and ingest signals.

   ATLAS covers adversarial tactics and techniques targeting AI/ML systems.
   Signals are typed 'threat_actor' with source 'mitre_atlas'. When processed,
   signals that match a known AI system in the platform route to the
   'AI Governance' domain for posture scoring and finding creation.

   Returns: { fetched, inserted, skipped_duplicate, skipped_invalid, errors }
   ========================================================= */

router.post(
  "/cyber-signals/fetch/mitre-atlas",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let fetched = 0;
    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      const { signals, total, skipped: skippedMapping } = await fetchMitreAtlasSignals();

      fetched = total;
      skippedInvalid = skippedMapping;

      for (const rawSignal of signals) {
        const validated = validateCyberSignalIngest(rawSignal);
        if ("error" in validated) {
          skippedInvalid++;
          errors.push(
            `validation_failed: ${validated.error}${validated.detail ? ` — ${validated.detail}` : ""}`
          );
          continue;
        }

        const normalized = normalizeSignal(validated.input);

        const client = await pg.connect();
        try {
          await client.query("BEGIN");

          const insertResult = await client.query(
            `
            INSERT INTO cyber_signals (
              organization_id,
              source,
              signal_type,
              severity,
              raw_payload,
              normalized_summary,
              affected_vendor,
              affected_cve,
              dedup_hash,
              external_id,
              ingestion_timestamp,
              processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), FALSE)
            ON CONFLICT (organization_id, dedup_hash) DO NOTHING
            RETURNING id, source, signal_type, severity, normalized_summary,
                      affected_vendor, affected_cve, organization_id
            `,
            [
              organizationId,
              normalized.source,
              normalized.signal_type,
              normalized.severity,
              JSON.stringify(encryptField(JSON.stringify(normalized.raw_payload))),
              normalized.normalized_summary,
              normalized.affected_vendor,
              normalized.affected_cve,
              normalized.dedup_hash,
              normalized.external_id
            ]
          );

          const isDuplicate = (insertResult.rowCount ?? 0) === 0;

          if (isDuplicate) {
            await client.query("COMMIT");
            skippedDuplicate++;
            continue;
          }

          const signal = insertResult.rows[0];
          await client.query("COMMIT");

          const signalRecord: CyberSignalRecord = {
            id: signal.id,
            organization_id: organizationId,
            source: signal.source,
            signal_type: signal.signal_type,
            severity: signal.severity,
            normalized_summary: signal.normalized_summary,
            affected_vendor: signal.affected_vendor,
            affected_cve: signal.affected_cve
          };

          await processSignal(signalRecord);
          inserted++;
        } catch (innerErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback failure
          }
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          errors.push(`insert_failed: ${msg}`);
        } finally {
          client.release();
        }
      }

      logger.info(
        {
          event: "mitre_atlas_fetch_complete",
          organizationId,
          fetched,
          inserted,
          skippedDuplicate,
          skippedInvalid,
          errorCount: errors.length
        },
        "MITRE ATLAS fetch complete"
      );

      res.status(200).json({
        fetched,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedInvalid,
        errors: errors.length > 0 ? errors.slice(0, 20) : []
      });
    } catch (err) {
      logger.error(
        { event: "mitre_atlas_fetch_failed", organizationId, err },
        "POST /api/cyber-signals/fetch/mitre-atlas failed"
      );
      res.status(502).json({
        error: "mitre_atlas_fetch_failed",
        message: err instanceof Error ? err.message : "Unknown error fetching MITRE ATLAS data"
      });
    }
  }
);

/* =========================================================
   POST /api/cyber-signals/:id/reprocess
   Re-run the processing pipeline on an existing signal.

   Use cases:
   - A vendor or AI system was added to the platform AFTER the signal was
     ingested. Reprocessing will now find the entity match and create a finding.
   - The initial processing failed (e.g., transient DB error) and the signal
     is stuck in processed=false.
   - Manual override to regenerate a stale finding.

   Reprocessing is idempotent with respect to findings: the processing service
   checks for an existing finding (source_type='cyber_signal', source_id=signal.id)
   and skips creation if one already exists. Risk exposure and posture are always
   re-evaluated.
   ========================================================= */

router.post(
  "/cyber-signals/:id/reprocess",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const signalId = String(req.params.id ?? "").trim();
    if (!signalId) {
      res.status(400).json({ error: "signal_id_required" });
      return;
    }
    if (!isUuid(signalId)) {
      res.status(400).json({ error: "signal_id_must_be_uuid" });
      return;
    }

    try {
      const signalResult = await pg.query(
        `
        SELECT ${SIGNAL_SELECT}
        FROM cyber_signals
        WHERE id = $1
          AND organization_id = $2
        `,
        [signalId, organizationId]
      );

      if ((signalResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "cyber_signal_not_found" });
        return;
      }

      const signal = signalResult.rows[0];

      const signalRecord: CyberSignalRecord = {
        id: signal.id,
        organization_id: organizationId,
        source: signal.source,
        signal_type: signal.signal_type,
        severity: signal.severity,
        normalized_summary: signal.normalized_summary,
        affected_vendor: signal.affected_vendor,
        affected_cve: signal.affected_cve
      };

      const processingResult = await processSignal(signalRecord);

      // Re-fetch to get updated state.
      const refreshedResult = await pg.query(
        `
        SELECT ${SIGNAL_SELECT}
        FROM cyber_signals
        WHERE id = $1
          AND organization_id = $2
        `,
        [signalId, organizationId]
      );

      logger.info(
        {
          event: "cyber_signal_reprocessed",
          organizationId,
          signalId,
          findingCreated: processingResult.finding !== null,
          risksFlagged: processingResult.risks_flagged,
          postureRecalculated: processingResult.posture_recalculated
        },
        "Cyber signal reprocessed"
      );

      res.status(200).json({
        signal: refreshedResult.rows[0] ?? signal,
        finding: processingResult.finding,
        matchedVendorId: processingResult.matched_vendor_id,
        matchedAiSystemId: processingResult.matched_ai_system_id,
        risksFlagged: processingResult.risks_flagged,
        postureRecalculated: processingResult.posture_recalculated
      });
    } catch (err) {
      logger.error(
        { event: "cyber_signal_reprocess_failed", err },
        "POST /api/cyber-signals/:id/reprocess failed"
      );
      res.status(500).json({ error: "cyber_signal_reprocess_failed" });
    }
  }
);

export default router;
