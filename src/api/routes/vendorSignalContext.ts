import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { analyzeVendorSignalContext } from "../lib/claudeAssessmentAnalyzer.js";
import { intelligenceEventsEnabled } from "../lib/signals/intelligenceEventsFeatureFlag.js";

const router = Router();

router.get(
  "/vendors/:id/signal-context",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req: Request, res: Response) => {
    try {
      const orgId: string = (req as unknown as { organizationContext: { organizationId: string } }).organizationContext?.organizationId;
      const vendorId = req.params["id"];

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      // Verify vendor belongs to this org
      const vendorResult = await pg.query<{ id: string; name: string }>(
        `SELECT id, name FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [vendorId, orgId]
      );

      if (!vendorResult.rows[0]) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      const vendor = vendorResult.rows[0];

      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      // Event-native (IE-AD-11): when the flag is on, the vendor's signal context
      // is sourced from canonical Intelligence Events (normalized, deduplicated,
      // display-safe summaries) rather than raw cyber_signals. Flag OFF → the
      // exact legacy raw-signal query, byte-identical.
      let signalsForAnalysis: Array<{
        id: string; title: string; severity: string; signal_type: string;
        normalized_summary: string; affected_vendor: string | null;
      }>;

      if (intelligenceEventsEnabled()) {
        const eventsResult = await pg.query<{
          id: string; event_type: string; severity: string; title: string;
          executive_summary: string; affected_vendor: string | null;
        }>(
          `SELECT id, event_type, severity, title, executive_summary, affected_vendor
             FROM intelligence_events
            WHERE lower(trim(affected_vendor)) = lower(trim($1))
              AND status <> 'archived'
            ORDER BY last_seen_at DESC
            LIMIT 50`,
          [vendor.name]
        );
        signalsForAnalysis = eventsResult.rows.map((e) => ({
          id: e.id,
          title: e.title,
          severity: e.severity,
          signal_type: e.event_type,
          normalized_summary: e.executive_summary, // normalized, never raw feed text
          affected_vendor: e.affected_vendor ?? null
        }));
      } else {
        const signalsResult = await pg.query<{
          id: string; signal_type: string; severity: string;
          normalized_summary: string; affected_vendor: string | null;
        }>(
          `SELECT id, signal_type, severity, normalized_summary, affected_vendor
           FROM cyber_signals
           WHERE organization_id = $1 AND ingestion_timestamp >= $2
           ORDER BY ingestion_timestamp DESC
           LIMIT 50`,
          [orgId, cutoff]
        );
        signalsForAnalysis = signalsResult.rows.map((s) => ({
          id: s.id,
          title: s.normalized_summary.slice(0, 100),
          severity: s.severity,
          signal_type: s.signal_type,
          normalized_summary: s.normalized_summary,
          affected_vendor: s.affected_vendor ?? null
        }));
      }

      const context = await analyzeVendorSignalContext(vendor.name, signalsForAnalysis, orgId);

      if (!context) {
        res.status(200).json({
          signal_context: {
            matchedSignals: [],
            overallRiskSummary: "No threat intelligence signals are available for this vendor.",
            suggestedAssessmentSeverity: null
          }
        });
        return;
      }

      res.status(200).json({ signal_context: context });
    } catch (err) {
      logger.error({ event: "vendor_signal_context_route_failed", err }, "GET /vendors/:id/signal-context failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
