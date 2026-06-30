/**
 * ask.ts — Natural language risk posture search ("Ask SecureLogic")
 *
 * POST /api/ask
 *
 * Accepts a plain-English question, fetches a real-time org-scoped
 * data snapshot from 7 parallel DB queries, and sends the snapshot
 * plus the question to Claude. Claude synthesises a structured answer
 * using ONLY the provided data — it never touches the DB.
 *
 * Security:
 *   - All DB queries are hardcoded parameterized statements; no SQL is
 *     generated from user input.
 *   - Rate limited to 20 questions / minute per org to contain Claude costs.
 *   - Claude receives only org-scoped pre-fetched data — no raw DB access.
 */

import Anthropic from "@anthropic-ai/sdk";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Router } from "express";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { renderProductKnowledge } from "../lib/productKnowledge.js";

const router = Router();

// ---------------------------------------------------------------------------
// Claude model
//
// Single source of truth for the model the Ask handler calls. Keep in sync
// with the codebase's other Sonnet-tier callers (briefSynthesizer.ts:38 and
// intelligenceBriefGenerator.ts:756) so a model bump only requires one edit
// per file. Was previously hardcoded as "claude-sonnet-4-20250514" in two
// places — that ID is retired and Anthropic returns model_not_found, which
// surfaced as 502 ask_failed in production.
// ---------------------------------------------------------------------------

const ASK_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Claude client
// ---------------------------------------------------------------------------

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

// ---------------------------------------------------------------------------
// System prompt
//
// Ask answers from TWO knowledge sources and must route between them:
//   1. PRODUCT KNOWLEDGE (static, injected below from productKnowledge.ts) —
//      how the platform works: navigation, features, how-to workflows. Used to
//      answer questions like "How do I add a vendor?". This is the fix for the
//      old behavior where Ask, having only the org data snapshot, wrongly said
//      it lacked the information for any how-to question.
//   2. ORG POSTURE DATA (per-request, in the user message) — this customer's
//      live findings/risks/vendors/posture. Used to answer "what is my …?".
//
// The base instructions establish the routing + guardrails; the rendered
// product-knowledge block is appended once at module load (it is identical
// across requests, which also keeps it prompt-cache friendly).
// ---------------------------------------------------------------------------

const BASE_INSTRUCTIONS = `
You are SecureLogic AI, the assistant embedded in the SecureLogic AI platform — a cyber, GRC, AI-governance, and third-party-risk posture product. You help customers in two ways and must choose the right source for each question:

1. PRODUCT / HOW-TO / NAVIGATION questions — e.g. "How do I add a vendor?", "Where is my Intelligence Brief?", "How do I improve my posture score?", "What can this platform do?". Answer these from the SECURELOGIC PRODUCT KNOWLEDGE section at the end of this prompt. That section is authoritative, current product documentation. When the answer is there, give it directly and helpfully — tell the user exactly where to click and the steps to follow. Do NOT say you "only" handle posture data, that you "don't have access", or that you "can't help with navigation" — if the product knowledge answers the question, you DO have the answer.

2. DATA / POSTURE questions — e.g. "What are my top risks?", "How many overdue actions do I have?", "Which vendors are critical?". Answer these using ONLY the organization posture data provided in the user message. Never invent data, scores, names, or ratings not present in that org context.

If a question has both aspects, answer both: explain the workflow from product knowledge AND cite the relevant numbers from the org context. Only state that something is unavailable if it is genuinely absent from BOTH the product knowledge and the org context — never reflexively claim a lack of access.

When answering:
- Lead with the direct answer
- For posture questions, support it with specific numbers from the org context
- For how-to questions, give the concrete navigation path / steps
- Highlight the most actionable insight when relevant
- Be concise — 2-4 sentences for simple questions, up to 8 for complex analyses
- Use plain language, not jargon

Risk ratings:
- Each risk has TWO ratings: inherent (pre-controls / worst case) and residual (post-controls / current state).
- When discussing a specific risk, label them clearly. Format as "Inherent rating: {value}, Residual rating: {value}".
- When summarizing risks in aggregate, default to residual unless the user explicitly asks about inherent (residual is "what we worry about right now given current mitigations"; inherent is "what we'd worry about if our controls failed").
- The legacy "risk_rating" field is the same value as residual_rating; treat them as equivalent.
- If a risk has a null inherent_rating or residual_rating, say so rather than guessing.

Format rules:
- Do not use markdown headers
- You may use bullet points for lists of 3+ items
- For posture answers, always cite specific numbers (e.g. "3 critical findings" not "several critical findings")

CRITICAL — applies to ORGANIZATION DATA only: never invent, assume, or generate proper nouns about this customer's environment — vendor names, domain names, team names, person names, or specific risk titles — that are not explicitly present in the org context data. If a list is empty or a field is null, state that no data is available rather than providing examples (e.g. if the vendor list is empty, say "no vendors have been added yet" — do not name hypothetical vendors). This rule does NOT restrict the PRODUCT KNOWLEDGE section: the feature names, navigation labels, and URL paths there are real and you should use them freely to answer how-to questions.
`.trim();

export function buildAskSystemPrompt(): string {
  return `${BASE_INSTRUCTIONS}\n\n---\n\n${renderProductKnowledge()}`;
}

const SYSTEM_PROMPT = buildAskSystemPrompt();

// ---------------------------------------------------------------------------
// Rate limiter — 20 questions per minute per org
// ---------------------------------------------------------------------------

const askRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).organizationId ?? (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  message: {
    error: "rate_limit_exceeded",
    message: "Too many questions. Wait 60 seconds.",
  },
});

// ---------------------------------------------------------------------------
// POST /api/ask
// ---------------------------------------------------------------------------

router.post(
  "/ask",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  askRateLimit,
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const { question } = req.body ?? {};

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "question_required", message: "question is required and must be a non-empty string" });
      return;
    }

    if (question.trim().length > 500) {
      res.status(400).json({ error: "question_too_long", message: "question must be 500 characters or fewer" });
      return;
    }

    const client = getClient();
    if (!client) {
      res.status(503).json({ error: "ask_unavailable", message: "AI query is not configured" });
      return;
    }

    try {
      // -----------------------------------------------------------------------
      // Fetch all context data in parallel — 8 queries (+ risk scale)
      // -----------------------------------------------------------------------
      const {
        postureResult,
        domainResult,
        findingsSummaryResult,
        topRisksResult,
        vendorCountResult,
        vendorsResult,
        actionsSummaryResult,
        criticalFindingsResult,
        riskScaleResult,
      } = await withTenant(organizationId, async () => {
        // Serialized reads on the single tenant client (commit-then-compute):
        // the Claude call below runs AFTER this tenant tx COMMITs, so the DB
        // connection is never held open across the multi-second LLM round-trip.
        // 1. Latest posture snapshot
        const postureResult = await pg.query<{
          overall_score: number | null;
          overall_severity: string | null;
          open_finding_count: number;
          open_action_count: number;
          overdue_action_count: number;
          snapshot_date: string;
          computation_rationale: Record<string, unknown>;
        }>(
          `SELECT overall_score, overall_severity,
                  open_finding_count, open_action_count, overdue_action_count,
                  snapshot_date, computation_rationale
           FROM posture_snapshots
           WHERE organization_id = $1
           ORDER BY snapshot_date DESC
           LIMIT 1`,
          [organizationId]
        );

        // 2. Domain scores from latest snapshot
        const domainResult = await pg.query<{
          domain: string;
          score: number | null;
          severity: string | null;
          trend_direction: string | null;
          finding_count: number;
          action_count: number;
        }>(
          `SELECT d.domain, d.score, d.severity, d.trend_direction,
                  d.finding_count, d.action_count
           FROM domain_scores d
           JOIN posture_snapshots p ON d.posture_snapshot_id = p.id
           WHERE p.organization_id = $1
           ORDER BY p.snapshot_date DESC, d.score ASC
           LIMIT 20`,
          [organizationId]
        );

        // 3. Findings summary
        const findingsSummaryResult = await pg.query<{
          open_count: string;
          critical_open: string;
          high_open: string;
          medium_open: string;
          low_open: string;
          closed_count: string;
          immediate_priority: string;
          vendor_sourced: string;
          signal_sourced: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'open')                                 AS open_count,
             COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical')       AS critical_open,
             COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high')           AS high_open,
             COUNT(*) FILTER (WHERE status = 'open' AND severity = 'medium')         AS medium_open,
             COUNT(*) FILTER (WHERE status = 'open' AND severity = 'low')            AS low_open,
             COUNT(*) FILTER (WHERE status != 'open')                                AS closed_count,
             COUNT(*) FILTER (WHERE status = 'open' AND priority = 'immediate')      AS immediate_priority,
             COUNT(*) FILTER (WHERE source_type = 'vendor_review')                   AS vendor_sourced,
             COUNT(*) FILTER (WHERE source_type = 'signal')                          AS signal_sourced
           FROM findings
           WHERE organization_id = $1`,
          [organizationId]
        );

        // 4. Top open risks ordered by severity
        const topRisksResult = await pg.query<{
          id: string;
          title: string;
          domain: string;
          likelihood: string | null;
          impact: string;
          risk_rating: string;
          inherent_rating: string | null;
          residual_rating: string | null;
          status: string;
          owner: string | null;
          due_date: string | null;
          treatment: string | null;
        }>(
          // Residual primary per Decision §3. Inherent surfaced for
          // LLM context — the prompt instruction below ("Inherent
          // rating: X, Residual rating: Y") tells the model to
          // distinguish them in conversation.
          `SELECT id, title, domain, likelihood, impact, risk_rating,
                  inherent_rating, residual_rating,
                  status, owner, due_date, treatment
           FROM risks
           WHERE organization_id = $1
             AND status = 'open'
           ORDER BY
             CASE residual_rating
               WHEN 'Critical' THEN 1
               WHEN 'High'     THEN 2
               WHEN 'Moderate' THEN 3
               WHEN 'Low'      THEN 4
             END ASC
           LIMIT 20`,
          [organizationId]
        );

        // 5a. Active vendor count
        const vendorCountResult = await pg.query<{ total: string }>(
          `SELECT COUNT(*) AS total
           FROM vendors
           WHERE organization_id = $1
             AND status != 'inactive'`,
          [organizationId]
        );

        // 5b. All active vendors ordered by criticality then risk score
        const vendorsResult = await pg.query<{
          id: string;
          name: string;
          criticality: string | null;
          current_risk_score: number | null;
          last_reviewed_at: string | null;
        }>(
          `SELECT id, name, criticality, current_risk_score, last_reviewed_at
           FROM vendors
           WHERE organization_id = $1
             AND status != 'inactive'
           ORDER BY
             CASE criticality
               WHEN 'critical' THEN 1
               WHEN 'high'     THEN 2
               WHEN 'medium'   THEN 3
               WHEN 'low'      THEN 4
               ELSE 5
             END,
             current_risk_score DESC NULLS LAST`,
          [organizationId]
        );

        // 6. Actions summary
        const actionsSummaryResult = await pg.query<{
          open_count: string;
          blocked_count: string;
          overdue_count: string;
          immediate_count: string;
          closed_count: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'blocked'))               AS open_count,
             COUNT(*) FILTER (WHERE status = 'blocked')                                          AS blocked_count,
             COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('closed', 'accepted'))   AS overdue_count,
             COUNT(*) FILTER (WHERE priority = 'immediate' AND status NOT IN ('closed','accepted')) AS immediate_count,
             COUNT(*) FILTER (WHERE status = 'closed')                                           AS closed_count
           FROM actions
           WHERE organization_id = $1`,
          [organizationId]
        );

        // 7. Recent high/critical open findings
        const criticalFindingsResult = await pg.query<{
          title: string;
          severity: string;
          status: string;
          source_type: string;
          domain: string | null;
          priority: string | null;
          created_at: string;
        }>(
          `SELECT title, severity, status, source_type, domain, priority, created_at
           FROM findings
           WHERE organization_id = $1
             AND severity IN ('critical', 'high')
             AND status = 'open'
           ORDER BY
             CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 END,
             created_at DESC
           LIMIT 15`,
          [organizationId]
        );

        // 8. Org risk scale
        const riskScaleResult = await pg.query<{
          preset_name: string;
          custom_levels: Array<{ value: string; label: string; color: string; rank: number }> | null;
          preset_levels: Array<{ value: string; label: string; color: string; rank: number }>;
          display_name: string;
        }>(
          `SELECT
             COALESCE(ors.preset_name, 'standard')  AS preset_name,
             ors.custom_levels,
             rsp.levels                              AS preset_levels,
             rsp.display_name
           FROM risk_scale_presets rsp
           LEFT JOIN organization_risk_scales ors
             ON ors.organization_id = $1
             AND ors.preset_name = rsp.name
           WHERE rsp.name = COALESCE(
             (SELECT preset_name FROM organization_risk_scales WHERE organization_id = $1),
             'standard'
           )`,
          [organizationId]
        );
        return {
          postureResult,
          domainResult,
          findingsSummaryResult,
          topRisksResult,
          vendorCountResult,
          vendorsResult,
          actionsSummaryResult,
          criticalFindingsResult,
          riskScaleResult,
        };
      });

      // -----------------------------------------------------------------------
      // Assemble context object
      // -----------------------------------------------------------------------
      const posture = postureResult.rows[0] ?? null;
      const fs  = findingsSummaryResult.rows[0];
      const as_ = actionsSummaryResult.rows[0];

      const scaleRow = riskScaleResult.rows[0] ?? null;
      const scaleLevels = scaleRow?.custom_levels ?? scaleRow?.preset_levels ?? [];
      const riskScaleContext = {
        name:   scaleRow?.display_name ?? "Standard",
        levels: scaleLevels.map((l: { label: string }) => l.label),
      };

      const findingsSummary = {
        open_count:         parseInt(fs?.open_count ?? "0", 10),
        critical_open:      parseInt(fs?.critical_open ?? "0", 10),
        high_open:          parseInt(fs?.high_open ?? "0", 10),
        medium_open:        parseInt(fs?.medium_open ?? "0", 10),
        low_open:           parseInt(fs?.low_open ?? "0", 10),
        closed_count:       parseInt(fs?.closed_count ?? "0", 10),
        immediate_priority: parseInt(fs?.immediate_priority ?? "0", 10),
        vendor_sourced:     parseInt(fs?.vendor_sourced ?? "0", 10),
        signal_sourced:     parseInt(fs?.signal_sourced ?? "0", 10),
      };

      const actionsSummary = {
        open_count:      parseInt(as_?.open_count ?? "0", 10),
        blocked_count:   parseInt(as_?.blocked_count ?? "0", 10),
        overdue_count:   parseInt(as_?.overdue_count ?? "0", 10),
        immediate_count: parseInt(as_?.immediate_count ?? "0", 10),
        closed_count:    parseInt(as_?.closed_count ?? "0", 10),
      };

      const context = {
        risk_scale: riskScaleContext,
        posture: posture
          ? {
              overall_score:    posture.overall_score,
              overall_severity: posture.overall_severity,
              open_findings:    posture.open_finding_count,
              open_actions:     posture.open_action_count,
              overdue_actions:  posture.overdue_action_count,
              as_of:            posture.snapshot_date,
            }
          : null,
        domains: domainResult.rows.map((d) => ({
          domain:   d.domain,
          score:    d.score,
          severity: d.severity,
          trend:    d.trend_direction,
          findings: d.finding_count,
        })),
        findings:  findingsSummary,
        top_risks: topRisksResult.rows,
        vendors: {
          total:          parseInt(vendorCountResult.rows[0]?.total ?? "0", 10),
          critical_count: vendorsResult.rows.filter((v) => v.criticality === "critical").length,
          high_count:     vendorsResult.rows.filter((v) => v.criticality === "high").length,
          assessed_count: vendorsResult.rows.filter((v) => v.current_risk_score !== null).length,
          list: vendorsResult.rows.map((v) => ({
            name:         v.name,
            criticality:  v.criticality,
            risk_score:   v.current_risk_score,
            last_reviewed: v.last_reviewed_at,
          })),
        },
        actions:   actionsSummary,
        critical_findings: criticalFindingsResult.rows,
      };

      // -----------------------------------------------------------------------
      // Call Claude
      // -----------------------------------------------------------------------
      const scaleInstruction = riskScaleContext.levels.length > 0
        ? `\n\nThis organization uses the following risk rating scale: ${riskScaleContext.levels.join(", ")}. Use these exact labels when referring to risk levels.`
        : "";

      const userMessage = `Here is the current risk posture data for this organization:\n\n${JSON.stringify(context, null, 2)}${scaleInstruction}\n\nQuestion: ${question.trim()}`;

      let answer: string;
      try {
        logger.info(
          { event: "llm_call_start", purpose: "ask_query", model: ASK_MODEL, organizationId },
          "LLM call: ask query"
        );
        const response = await client.messages.create({
          model: ASK_MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        answer = textBlock && "text" in textBlock ? textBlock.text : "";
      } catch (claudeErr) {
        logger.error({ event: "ask_claude_failed", organizationId, claudeErr }, "Claude API call failed");
        res.status(502).json({ error: "ask_failed", message: "Unable to process query" });
        return;
      }

      res.status(200).json({
        answer,
        context_used: {
          posture_score:   posture?.overall_score ?? null,
          findings_count:  findingsSummary.open_count,
          risks_count:     topRisksResult.rows.length,
          vendors_count:   parseInt(vendorCountResult.rows[0]?.total ?? "0", 10),
          as_of:           posture?.snapshot_date ?? null,
        },
        question: question.trim(),
      });
    } catch (err) {
      logger.error({ event: "ask_failed", err }, "POST /api/ask failed");
      res.status(500).json({ error: "ask_failed", message: "Unable to process query" });
    }
  }
);

export default router;
