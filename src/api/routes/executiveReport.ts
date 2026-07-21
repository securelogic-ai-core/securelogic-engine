/**
 * executiveReport.ts — Executive Security Posture PDF Report
 *
 * One-page-per-section summary: posture score, risk breakdown,
 * framework compliance, and open findings. Designed for leadership.
 *
 * Route: GET /api/reports/executive.pdf
 * Auth: requireApiKey → attachOrganizationContext → requireEntitlement("premium")
 */

import { Router } from "express";
import PDFDocument from "pdfkit";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { sqlFindingActive } from "../lib/metricDefinitions.js";
import { toDisplayPosture, toDisplayDomain } from "../lib/postureDisplay.js";
import { secureLogicLogo, stampFooters } from "../lib/reportBranding.js";

const router = Router();

// ─── Color palette — matches gapReport.ts ────────────────────────────────────
const TEAL         = "#00C4B4";
const SLATE        = "#334155";
const RED          = "#EF4444";
const AMBER        = "#F59E0B";
const ORANGE       = "#F97316";
const GREEN        = "#22C55E";
const LIGHT_BG     = "#F8FAFC";
const RULE_COLOR   = "#CBD5E1";
const TEXT_PRIMARY = "#0F172A";
const TEXT_MUTED   = "#64748B";
const WHITE        = "#FFFFFF";

// ─── Types ───────────────────────────────────────────────────────────────────

type PostureRow = {
  overall_score: number | null;
  overall_severity: string | null;
  snapshot_date: string | null;
};

// One row of the reconciled posture domain breakdown, sourced from the SAME
// saved snapshot as /posture (domain_scores joined to the latest snapshot).
// `score` is health-style (0–100, higher = better) after conversion through the
// canonical postureDisplay mapper. `finding_count` is the corrected primary-
// domain rollup (2026-07-17 #683): each active finding counted exactly once
// under its primary domain, so counts sum to the snapshot's active-finding
// total.
type DomainBreakdownRow = {
  domain: string;
  score: number | null;
  severity: string | null;
  finding_count: number;
};

type FrameworkRow = {
  framework_id: string;
  name: string;
  version: string;
  total: string;
  satisfied: string;
  partial: string;
  unmapped: string;
};

type FindingSeverityRow = {
  severity: string;
  count: string;
};

type RecentFinding = {
  title: string;
  severity: string;
  status: string;
  created_at: string;
};

export type ExecReportData = {
  generated_at:       string;
  org_name:           string;
  posture:            PostureRow | null;
  // Comparison snapshot ~90 days back (or the earliest available) — powers the
  // posture trend line. Null when only one snapshot exists.
  posture_prior:      PostureRow | null;
  // Reconciled domain breakdown from the SAME latest snapshot as `posture`
  // (empty when no snapshot / no domain rows). Ordered severity-first then
  // domain, exactly as GET /api/posture/latest orders it.
  posture_domains:    DomainBreakdownRow[];
  // The snapshot's own open_finding_count — the reconciliation target the
  // per-domain finding counts sum to. Null when there is no snapshot.
  posture_finding_total: number | null;
  open_actions_count: number;
  risks_by_rating:           Array<{ rating: string; count: number }>;
  risks_by_inherent_rating:  Array<{ rating: string; count: number }>;
  frameworks:         Array<{
    name:      string;
    version:   string;
    total:     number;
    satisfied: number;
    partial:   number;
    unmapped:  number;
  }>;
  findings_by_severity: Array<{ severity: string; count: number }>;
  recent_findings:      RecentFinding[];
  // 90-day decision record, sourced from the immutable lifecycle event
  // streams (finding_lifecycle_events / risk_lifecycle_events) — the
  // proof-of-action story: what we decided, closed, accepted, reopened.
  period: {
    days: number;
    findings_closed: number;
    findings_risk_accepted: number;
    findings_reopened: number;
    findings_remediated: number;
    findings_new: number;
    risks_closed: number;
    risk_approvals: number;
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9_\-]/gi, "-").toLowerCase().slice(0, 40);
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function scoreColor(score: number): string {
  if (score >= 70) return TEAL;
  if (score >= 40) return AMBER;
  return RED;
}

function severityColor(sev: string | null | undefined): string {
  switch ((sev ?? "").toLowerCase()) {
    case "critical": return RED;
    case "high":     return ORANGE;
    case "moderate": return AMBER;
    case "low":      return GREEN;
    default:         return TEXT_MUTED;
  }
}

function daysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

// ─── Data assembly ────────────────────────────────────────────────────────────

async function assembleExecReport(organizationId: string): Promise<ExecReportData> {
  // Serialized reads (single tenant client under withTenant; see
  // docs/investigation/rls-aggregator-track-determination-2026-06-24.md).

    // 1. Org name
  const orgResult = await pg.query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1`,
      [organizationId]
    );

    // 2. Latest posture snapshot — id + open_finding_count are read alongside
    // the headline fields so the domain breakdown (next query) is drawn from the
    // exact same saved snapshot /posture renders, and reconciles to it.
  const postureResult = await pg.query<PostureRow & { id: string; open_finding_count: number | null }>(
      `SELECT id, overall_score, overall_severity, open_finding_count,
              snapshot_date::text AS snapshot_date
       FROM posture_snapshots
       WHERE organization_id = $1
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [organizationId]
    );

    // 2b. Reconciled domain breakdown for that snapshot — the SAME rows, in the
    // SAME order, as GET /api/posture/latest. `score` is risk-style in the DB;
    // it converts to health-style once, below, through the canonical mapper.
    // finding_count is the corrected primary-domain rollup (#683) and sums to
    // the snapshot's open_finding_count.
  const latestSnapshotId = postureResult.rows[0]?.id ?? null;
  const domainResult = latestSnapshotId
      ? await pg.query<DomainBreakdownRow>(
          `SELECT domain, score, severity, finding_count
           FROM domain_scores
           WHERE posture_snapshot_id = $1
           ORDER BY CASE severity
             WHEN 'Critical' THEN 1 WHEN 'High'     THEN 2
             WHEN 'Moderate' THEN 3 WHEN 'Low'      THEN 4
             ELSE 5 END,
             domain ASC`,
          [latestSnapshotId]
        )
      : { rows: [] as DomainBreakdownRow[] };

    // 3. Open risks by RESIDUAL rating per Decision §3 — the executive
    // report shows the post-controls assessment as primary. Inherent
    // is collected separately (next pg.query) for context.
  const riskResult = await pg.query<{ residual_rating: string; count: string }>(
      `SELECT residual_rating, COUNT(*)::text AS count
       FROM risks
       WHERE organization_id = $1
         AND status NOT IN ('closed', 'transferred')
         AND residual_rating IS NOT NULL
       GROUP BY residual_rating
       ORDER BY CASE residual_rating
         WHEN 'Critical' THEN 1 WHEN 'High' THEN 2
         WHEN 'Moderate' THEN 3 WHEN 'Low'  THEN 4
         ELSE 5 END`,
      [organizationId]
    );

    // 3b. Open risks by INHERENT rating — context only.
  const inherentRiskResult = await pg.query<{ inherent_rating: string; count: string }>(
      `SELECT inherent_rating, COUNT(*)::text AS count
       FROM risks
       WHERE organization_id = $1
         AND status NOT IN ('closed', 'transferred')
         AND inherent_rating IS NOT NULL
       GROUP BY inherent_rating
       ORDER BY CASE inherent_rating
         WHEN 'Critical' THEN 1 WHEN 'High' THEN 2
         WHEN 'Moderate' THEN 3 WHEN 'Low'  THEN 4
         ELSE 5 END`,
      [organizationId]
    );

    // 4. Framework compliance via control-mapping logic (same as gapReport.ts)
  const frameworkResult = await pg.query<FrameworkRow>(
      `WITH fw_reqs AS (
         SELECT f.id AS framework_id, f.name, f.version, r.id AS req_id
         FROM frameworks f
         JOIN requirements r ON r.framework_id = f.id
         WHERE f.organization_id = $1
       ),
       req_status AS (
         SELECT
           fr.framework_id,
           fr.name,
           fr.version,
           fr.req_id,
           CASE
             WHEN EXISTS (
               SELECT 1
               FROM control_mappings cm
               JOIN controls c       ON c.id = cm.control_id AND c.organization_id = $1
               JOIN control_assessments ca
                 ON ca.control_id = c.id AND ca.organization_id = $1 AND ca.status = 'passed'
               WHERE cm.requirement_id = fr.req_id
             ) THEN 'satisfied'
             WHEN EXISTS (
               SELECT 1
               FROM control_mappings cm
               JOIN controls c ON c.id = cm.control_id AND c.organization_id = $1
               WHERE cm.requirement_id = fr.req_id
             ) THEN 'partial'
             ELSE 'unmapped'
           END AS status
         FROM fw_reqs fr
       )
       SELECT
         framework_id,
         name,
         version,
         COUNT(*)::text                                    AS total,
         COUNT(CASE WHEN status = 'satisfied' THEN 1 END)::text AS satisfied,
         COUNT(CASE WHEN status = 'partial'   THEN 1 END)::text AS partial,
         COUNT(CASE WHEN status = 'unmapped'  THEN 1 END)::text AS unmapped
       FROM req_status
       GROUP BY framework_id, name, version
       ORDER BY name`,
      [organizationId]
    );

    // 5. Open findings by severity
  const findingsSevResult = await pg.query<FindingSeverityRow>(
      `SELECT severity, COUNT(*)::text AS count
       FROM findings
       WHERE organization_id = $1
         AND ${sqlFindingActive()}
       GROUP BY severity
       ORDER BY CASE severity
         WHEN 'Critical' THEN 1 WHEN 'High'     THEN 2
         WHEN 'Moderate' THEN 3 WHEN 'Low'      THEN 4
         ELSE 5 END`,
      [organizationId]
    );

    // 6. 5 most critical open findings (for the findings table)
  const recentFindingsResult = await pg.query<RecentFinding>(
      `SELECT title, severity, status, created_at::text AS created_at
       FROM findings
       WHERE organization_id = $1
         AND ${sqlFindingActive()}
       ORDER BY
         CASE severity
           WHEN 'Critical' THEN 1 WHEN 'High' THEN 2
           WHEN 'Moderate' THEN 3 WHEN 'Low'  THEN 4
           ELSE 5 END ASC,
         created_at ASC
       LIMIT 5`,
      [organizationId]
    );

    // 7. Open actions count
  const actionsResult = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM actions
       WHERE organization_id = $1
         AND status NOT IN ('done', 'cancelled', 'closed', 'resolved')`,
      [organizationId]
    );

    // 8. Posture trend comparison snapshot: latest snapshot at least ~90 days
    // old; when the program is younger than that, the earliest snapshot.
    // Only used when it is genuinely a DIFFERENT snapshot than the latest.
  const priorPostureResult = await pg.query<PostureRow>(
      `SELECT overall_score, overall_severity, snapshot_date::text AS snapshot_date
       FROM posture_snapshots
       WHERE organization_id = $1
         AND snapshot_date <= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [organizationId]
    );
  const earliestPostureResult = priorPostureResult.rows.length === 0
      ? await pg.query<PostureRow>(
          `SELECT overall_score, overall_severity, snapshot_date::text AS snapshot_date
           FROM posture_snapshots
           WHERE organization_id = $1
           ORDER BY snapshot_date ASC
           LIMIT 1`,
          [organizationId]
        )
      : null;
  const latestSnapshotDate = postureResult.rows[0]?.snapshot_date ?? null;
  const priorCandidate = priorPostureResult.rows[0] ?? earliestPostureResult?.rows[0] ?? null;
  const posturePrior =
      priorCandidate && priorCandidate.snapshot_date !== latestSnapshotDate ? priorCandidate : null;

    // 9. 90-day decision record from the immutable lifecycle streams —
    // "here is what we decided and did", sourced from the audit substrate,
    // never re-derived from mutable state.
  const findingEventsResult = await pg.query<{ transition: string; count: string }>(
      `SELECT transition, COUNT(*)::text AS count
       FROM finding_lifecycle_events
       WHERE organization_id = $1
         AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY transition`,
      [organizationId]
    );
  const riskEventsResult = await pg.query<{ transition: string; count: string }>(
      `SELECT transition, COUNT(*)::text AS count
       FROM risk_lifecycle_events
       WHERE organization_id = $1
         AND created_at >= NOW() - INTERVAL '90 days'
         AND transition IN ('close', 'approve')
       GROUP BY transition`,
      [organizationId]
    );
  const newFindingsResult = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM findings
       WHERE organization_id = $1
         AND created_at >= NOW() - INTERVAL '90 days'`,
      [organizationId]
    );
  const transitionCount = (rows: Array<{ transition: string; count: string }>, t: string): number =>
      parseInt(rows.find((r) => r.transition === t)?.count ?? "0", 10);

  return {
    generated_at:       new Date().toISOString(),
    org_name:           orgResult.rows[0]?.name ?? "Unknown Organization",
    // Health-style display values (walkthrough ruling) — the report shows what
    // the dashboard shows. Both points of the trend convert through ONE mapper.
    posture:            postureResult.rows[0] ? toDisplayPosture(postureResult.rows[0]) : null,
    posture_prior:      posturePrior ? toDisplayPosture(posturePrior) : null,
    // Domain scores converted through the SAME health-style mapper /posture
    // uses (toDisplayDomain → toDisplayScore); order is preserved from the query.
    posture_domains:    domainResult.rows.map(toDisplayDomain),
    posture_finding_total: postureResult.rows[0]?.open_finding_count ?? null,
    period: {
      days: 90,
      findings_closed:        transitionCount(findingEventsResult.rows, "close"),
      findings_risk_accepted: transitionCount(findingEventsResult.rows, "accept_risk"),
      findings_reopened:      transitionCount(findingEventsResult.rows, "reopen"),
      findings_remediated:    transitionCount(findingEventsResult.rows, "operational_remediated"),
      findings_new:           parseInt(newFindingsResult.rows[0]?.count ?? "0", 10),
      risks_closed:           transitionCount(riskEventsResult.rows, "close"),
      risk_approvals:         transitionCount(riskEventsResult.rows, "approve"),
    },
    open_actions_count: parseInt(actionsResult.rows[0]?.count ?? "0", 10),
    // Primary: residual rating per Decision §3. The PDF section
    // labelled "Risks by Rating" shows the post-controls assessment.
    risks_by_rating:    riskResult.rows.map((r) => ({ rating: r.residual_rating, count: parseInt(r.count, 10) })),
    risks_by_inherent_rating: inherentRiskResult.rows.map((r) => ({ rating: r.inherent_rating, count: parseInt(r.count, 10) })),
    frameworks:         frameworkResult.rows.map((r) => ({
      name:      r.name,
      version:   r.version,
      total:     parseInt(r.total, 10),
      satisfied: parseInt(r.satisfied, 10),
      partial:   parseInt(r.partial, 10),
      unmapped:  parseInt(r.unmapped, 10),
    })),
    findings_by_severity: findingsSevResult.rows.map((r) => ({
      severity: r.severity,
      count:    parseInt(r.count, 10),
    })),
    recent_findings: recentFindingsResult.rows,
  };
}

// ─── PDF generation ───────────────────────────────────────────────────────────

export function generateExecutivePDF(data: ExecReportData, out: NodeJS.WritableStream): void {
  const doc = new PDFDocument({
    margin:      50,
    size:        "A4",
    bufferPages: true,
    info: {
      Title:   `Executive Security Report — ${data.org_name}`,
      Author:  "SecureLogic AI",
      Subject: "Executive Security Posture Report",
    },
  });

  doc.pipe(out);

  const pageW         = doc.page.width;   // 595.28
  const pageH         = doc.page.height;  // 841.89
  const margin        = 50;
  const contentW      = pageW - margin * 2;
  const contentBottom = pageH - 50;

  // ─── Page 1: Cover ───────────────────────────────────────────────────────────

  // Top accent bar
  doc.rect(0, 0, pageW, 20).fill(TEAL);

  // Logo — the canonical SecureLogic AI logo asset; text wordmark only if
  // the asset is unavailable (never a substitute logo).
  const logo = secureLogicLogo();
  if (logo) {
    doc.image(logo, margin, 44, { width: 90 });
  } else {
    doc
      .fillColor(TEAL)
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("SecureLogic AI", margin, 50, { width: contentW });
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text("Security Intelligence Platform", margin, 72, { width: contentW });
  }

  // Main title block
  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text("EXECUTIVE SECURITY REPORT", margin, 180, { width: contentW });
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(16)
    .text(data.org_name, margin, 222, { width: contentW });

  // Horizontal rule
  doc.rect(margin, 262, contentW, 1).fill(RULE_COLOR);

  // Report metadata
  const metaItems: Array<[string, string, boolean]> = [
    ["Prepared",      fmtDate(data.generated_at),  false],
    ["Generated by",  "SecureLogic AI",             false],
    ["Classification","CONFIDENTIAL",               true],
  ];

  let metaY = 282;
  for (const [label, value, highlight] of metaItems) {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(10)
      .text(`${label}:`, margin, metaY, { width: 100, lineBreak: false });
    doc
      .fillColor(highlight ? RED : TEXT_PRIMARY)
      .font(highlight ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .text(value, margin + 100, metaY, { width: contentW - 100, lineBreak: false });
    metaY += 20;
  }

  // Confidential stamp box
  const stampW = 200;
  const stampX = (pageW - stampW) / 2;
  const stampY = 680;
  doc.rect(stampX, stampY, stampW, 32).stroke(RED);
  doc
    .fillColor(RED)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("CONFIDENTIAL", stampX, stampY + 10, { width: stampW, align: "center" });

  // Confidentiality notice
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text(
      "This document contains confidential security information. " +
      "Distribution should be limited to authorized personnel only.",
      margin, 730,
      { width: contentW, align: "center" }
    );

  // ─── Page 2: Security Posture Overview ───────────────────────────────────────

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Security Posture Overview", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(1.2);

  // Stat boxes — 2×2 grid
  const gap    = 16;
  const boxW   = (contentW - gap) / 2;
  const boxH   = 80;
  const gridTop = doc.y;

  const totalFindings = data.findings_by_severity.reduce((s, f) => s + f.count, 0);
  const postureScore  = data.posture?.overall_score ?? null;
  const postureSev    = data.posture?.overall_severity ?? null;

  const statBoxes = [
    {
      value: postureScore !== null ? `${postureScore}/100` : "—",
      label: "Overall Posture Score",
      sub:   data.posture?.snapshot_date ? `as of ${fmtDate(data.posture.snapshot_date)}` : "No snapshot yet",
      color: postureScore !== null ? scoreColor(postureScore) : TEXT_MUTED,
    },
    {
      value: postureSev ?? "—",
      label: "Current Severity",
      sub:   "Based on latest snapshot",
      color: severityColor(postureSev),
    },
    {
      value: String(totalFindings),
      label: "Open Findings",
      sub:   "Require attention",
      color: totalFindings > 0 ? RED : GREEN,
    },
    {
      value: String(data.open_actions_count),
      label: "Open Actions",
      sub:   "Pending remediation",
      color: data.open_actions_count > 0 ? AMBER : GREEN,
    },
  ];

  statBoxes.forEach((box, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx  = margin + col * (boxW + gap);
    const by  = gridTop + row * (boxH + gap);

    doc.roundedRect(bx, by, boxW, boxH, 6).fillAndStroke(LIGHT_BG, RULE_COLOR);

    doc
      .fillColor(box.color)
      .font("Helvetica-Bold")
      .fontSize(24)
      .text(box.value, bx + 14, by + 12, { width: boxW - 28, lineBreak: false });
    doc
      .fillColor(TEXT_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(box.label, bx + 14, by + 44, { width: boxW - 28, lineBreak: false });
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(box.sub, bx + 14, by + 57, { width: boxW - 28, lineBreak: false });
  });

  // Advance past grid, then a one-line scale note so the posture number is never
  // read as "higher = worse".
  doc.y = gridTop + 2 * (boxH + gap) + 10;
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text(
      "Posture and domain health scores use a 0-100 scale where higher = better.",
      margin, doc.y,
      { width: contentW, lineBreak: false }
    );
  doc.y = doc.y + 22;

  // Risk breakdown table
  if (data.risks_by_rating.length > 0) {
    doc
      .fillColor(TEXT_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Open Risk Register", margin, doc.y);
    doc.rect(margin, doc.y + 4, contentW, 1).fill(RULE_COLOR);
    doc.moveDown(0.8);

    const totalRisks = data.risks_by_rating.reduce((s, r) => s + r.count, 0);

    // Table header
    const hY = doc.y;
    doc.rect(margin, hY, contentW, 18).fill(SLATE);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("RISK RATING", margin + 8, hY + 5, { width: 120, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("COUNT", margin + 140, hY + 5, { width: 60, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("% OF TOTAL", margin + 220, hY + 5, { width: 80, lineBreak: false });

    let tblY = hY + 18;
    data.risks_by_rating.forEach((risk, idx) => {
      const rowBg = idx % 2 === 0 ? WHITE : LIGHT_BG;
      doc.rect(margin, tblY, contentW, 18).fill(rowBg);

      const pct = totalRisks > 0 ? Math.round((risk.count / totalRisks) * 100) : 0;
      const ratingColor = severityColor(risk.rating);

      doc.fillColor(ratingColor).font("Helvetica-Bold").fontSize(9)
        .text(risk.rating, margin + 8, tblY + 5, { width: 120, lineBreak: false });
      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(9)
        .text(String(risk.count), margin + 140, tblY + 5, { width: 60, lineBreak: false });
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(9)
        .text(`${pct}%`, margin + 220, tblY + 5, { width: 80, lineBreak: false });

      tblY += 18;
    });

    // Total row
    doc.rect(margin, tblY, contentW, 18).fill(LIGHT_BG);
    doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(9)
      .text("TOTAL", margin + 8, tblY + 5, { width: 120, lineBreak: false });
    doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(9)
      .text(String(totalRisks), margin + 140, tblY + 5, { width: 60, lineBreak: false });
    doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(9)
      .text("100%", margin + 220, tblY + 5, { width: 80, lineBreak: false });

  } else {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text("No open risks recorded.", margin, doc.y, { width: contentW });
  }

  // ─── Page 3: Posture Domain Breakdown ────────────────────────────────────────
  // The reconciled per-domain view from /posture, drawn off the SAME saved
  // snapshot. Health scores are 0-100 (higher = better); finding counts are the
  // corrected primary-domain rollup (#683) and sum to Total Active Findings.

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Posture Domain Breakdown", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(0.8);

  if (data.posture_domains.length === 0) {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica-Oblique")
      .fontSize(10)
      .text(
        data.posture
          ? "The latest posture snapshot has no domain breakdown yet."
          : "No posture snapshot exists yet. Run a snapshot to populate the domain breakdown.",
        margin, doc.y,
        { width: contentW }
      );
  } else {
    const snapLabel = data.posture?.snapshot_date ? fmtDate(data.posture.snapshot_date) : "the latest snapshot";
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `From the ${snapLabel} posture snapshot — the same reconciled view shown on the Posture ` +
        "dashboard. Health scores are 0-100 (higher = better). Finding counts are unique active " +
        "findings by primary domain and sum to Total Active Findings.",
        margin, doc.y,
        { width: contentW, lineGap: 1 }
      );
    doc.moveDown(0.8);

    // Column geometry
    const cScore = 96;
    const cSev   = 90;
    const cCount = 70;
    const cDomain = contentW - cScore - cSev - cCount;
    const xDomain = margin;
    const xScore  = margin + cDomain;
    const xSev    = margin + cDomain + cScore;
    const xCount  = margin + cDomain + cScore + cSev;

    // Header
    const hY = doc.y;
    doc.rect(margin, hY, contentW, 18).fill(SLATE);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("DOMAIN", xDomain + 8, hY + 5, { width: cDomain - 12, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("HEALTH (0-100)", xScore + 4, hY + 5, { width: cScore - 8, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("SEVERITY", xSev + 4, hY + 5, { width: cSev - 8, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("FINDINGS", xCount + 4, hY + 5, { width: cCount - 8, lineBreak: false });

    let dY = hY + 18;
    let domainFindingSum = 0;
    data.posture_domains.forEach((d, idx) => {
      const bg = idx % 2 === 0 ? WHITE : LIGHT_BG;
      doc.rect(margin, dY, contentW, 18).fill(bg);

      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(9)
        .text(d.domain, xDomain + 8, dY + 5, { width: cDomain - 12, lineBreak: false });
      doc.fillColor(d.score !== null ? scoreColor(d.score) : TEXT_MUTED).font("Helvetica-Bold").fontSize(9)
        .text(d.score !== null ? `${d.score}/100` : "—", xScore + 4, dY + 5, { width: cScore - 8, lineBreak: false });
      doc.fillColor(severityColor(d.severity)).font("Helvetica-Bold").fontSize(9)
        .text(d.severity ?? "—", xSev + 4, dY + 5, { width: cSev - 8, lineBreak: false });
      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(9)
        .text(String(d.finding_count), xCount + 4, dY + 5, { width: cCount - 8, lineBreak: false });

      domainFindingSum += d.finding_count;
      dY += 18;
    });

    // Total row — the per-domain counts reconcile to Total Active Findings.
    doc.rect(margin, dY, contentW, 18).fill(LIGHT_BG);
    doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(9)
      .text("TOTAL ACTIVE FINDINGS", xDomain + 8, dY + 5, { width: cDomain + cScore + cSev - 12, lineBreak: false });
    doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(9)
      .text(String(domainFindingSum), xCount + 4, dY + 5, { width: cCount - 8, lineBreak: false });
    dY += 18;
    doc.y = dY + 12;

    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        "Health = 0-100, higher = better (a Critical domain sits beside a low health score). " +
        "Each active finding is counted once under its primary domain, so the domain counts sum " +
        "to Total Active Findings on this snapshot.",
        margin, doc.y,
        { width: contentW, lineGap: 1 }
      );
  }

  // ─── Page 4: Framework Compliance ────────────────────────────────────────────

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Framework Compliance", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(0.6);

  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(
      "Coverage is derived from control mappings and assessment status. " +
      "Satisfied = mapped control with a passed assessment. " +
      "Partial = mapped but not assessed or failing. " +
      "Unmapped = no controls mapped.",
      margin, doc.y,
      { width: contentW, lineGap: 1 }
    );
  doc.moveDown(0.8);

  if (data.frameworks.length === 0) {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica-Oblique")
      .fontSize(10)
      .text("No frameworks configured.", margin, doc.y, { width: contentW });
  } else {
    const barMaxW   = contentW - 180;
    const barH      = 8;
    const rowHeight = 56;

    for (const fw of data.frameworks) {
      if (doc.y + rowHeight > contentBottom - 10) {
        doc.addPage();
        doc.y = margin;
      }

      const rowY        = doc.y;
      const readiness   = fw.total > 0 ? Math.round((fw.satisfied / fw.total) * 100) : 0;
      const rColor      = scoreColor(readiness);

      // Framework name + version
      doc
        .fillColor(TEXT_PRIMARY)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(`${fw.name} ${fw.version}`, margin, rowY, { width: contentW - 70, lineBreak: false });

      // Readiness % right-aligned
      doc
        .fillColor(rColor)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(`${readiness}%`, margin, rowY, { width: contentW, align: "right", lineBreak: false });

      const countY = rowY + 16;
      const counts = [
        { label: `${fw.satisfied} satisfied`, color: GREEN },
        { label: `${fw.partial} partial`,     color: AMBER },
        { label: `${fw.unmapped} unmapped`,   color: TEXT_MUTED },
        { label: `${fw.total} total`,          color: TEXT_PRIMARY },
      ];
      let cx = margin;
      for (const c of counts) {
        doc.fillColor(c.color).font("Helvetica").fontSize(8)
          .text(c.label, cx, countY, { lineBreak: false });
        cx += doc.widthOfString(c.label) + 12;
      }

      // Progress bar
      const barY = countY + 14;
      const total = fw.total || 1;
      const satW  = Math.round((fw.satisfied / total) * barMaxW);
      const parW  = Math.round((fw.partial   / total) * barMaxW);
      const unmW  = Math.max(0, barMaxW - satW - parW);

      // Background
      doc.roundedRect(margin, barY, barMaxW, barH, 3).fill("#E2E8F0");
      // Satisfied (green)
      if (satW > 0) doc.roundedRect(margin, barY, satW, barH, 3).fill(GREEN);
      // Partial (amber) — stacked after satisfied
      if (parW > 0) {
        doc.rect(margin + satW, barY, parW, barH).fill(AMBER);
      }
      // Unmapped (gray, at the end — drawn implicitly by background)

      // Separator
      doc.rect(margin, barY + barH + 10, contentW, 0.5).fill(RULE_COLOR);

      doc.y = barY + barH + 20;
    }
  }

  // Legend
  if (data.frameworks.length > 0 && doc.y + 20 < contentBottom) {
    doc.moveDown(0.4);
    const legendItems: Array<[string, string]> = [
      [GREEN,    "Satisfied"],
      [AMBER,    "Partial"],
      ["#E2E8F0","Unmapped"],
    ];
    let lx = margin;
    for (const [color, label] of legendItems) {
      doc.rect(lx, doc.y, 10, 10).fill(color);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(8)
        .text(label, lx + 13, doc.y + 1, { lineBreak: false });
      lx += doc.widthOfString(label) + 28;
    }
  }

  // ─── Page 5: Open Findings ────────────────────────────────────────────────────

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Open Security Findings", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(1);

  // Severity bar chart
  if (data.findings_by_severity.length === 0) {
    doc
      .fillColor(GREEN)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("No open findings. Clean posture.", margin, doc.y, { width: contentW });
  } else {
    const sevColors: Record<string, string> = {
      Critical: RED,
      High:     ORANGE,
      Moderate: AMBER,
      Low:      "#84CC16",
    };
    const maxCount = Math.max(...data.findings_by_severity.map((f) => f.count));
    const barMaxW  = contentW - 130;
    let chartY     = doc.y;

    for (const finding of data.findings_by_severity) {
      if (chartY + 22 > contentBottom - 80) break;
      const barW   = Math.max(3, Math.round((finding.count / maxCount) * barMaxW));
      const sColor = sevColors[finding.severity] ?? TEXT_MUTED;

      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(9)
        .text(finding.severity, margin, chartY + 3, { width: 72, lineBreak: false });
      doc.roundedRect(margin + 76, chartY, barW, 14, 2).fill(sColor);
      doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(9)
        .text(String(finding.count), margin + 76 + barW + 8, chartY + 3, { width: 40, lineBreak: false });

      chartY += 22;
    }

    doc.y = chartY + 16;
  }

  // Top 5 open findings table
  if (data.recent_findings.length > 0 && doc.y + 100 < contentBottom) {
    doc
      .fillColor(TEXT_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Priority Open Findings", margin, doc.y);
    doc.rect(margin, doc.y + 4, contentW, 1).fill(RULE_COLOR);
    doc.moveDown(0.6);

    // Column widths
    const colTitle   = contentW - 100 - 60;  // ~235
    const colSev     = 100;
    const colAge     = 60;
    const xTitle     = margin;
    const xSev       = margin + colTitle;
    const xAge       = margin + colTitle + colSev;

    // Header
    const thY = doc.y;
    doc.rect(margin, thY, contentW, 16).fill(SLATE);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("FINDING", xTitle + 4, thY + 4, { width: colTitle, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("SEVERITY", xSev + 4, thY + 4, { width: colSev, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("DAYS OPEN", xAge + 4, thY + 4, { width: colAge, lineBreak: false });

    let rowY = thY + 16;
    data.recent_findings.forEach((f, idx) => {
      if (rowY + 18 > contentBottom - 30) return;
      const bg    = idx % 2 === 0 ? WHITE : LIGHT_BG;
      const title = f.title.length > 52 ? f.title.slice(0, 50) + "…" : f.title;
      const age   = daysOpen(f.created_at);

      doc.rect(margin, rowY, contentW, 18).fill(bg);
      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(8)
        .text(title, xTitle + 4, rowY + 5, { width: colTitle - 8, lineBreak: false });
      doc.fillColor(severityColor(f.severity)).font("Helvetica-Bold").fontSize(8)
        .text(f.severity, xSev + 4, rowY + 5, { width: colSev - 8, lineBreak: false });
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(8)
        .text(`${age}d`, xAge + 4, rowY + 5, { width: colAge - 8, lineBreak: false });

      rowY += 18;
    });

    // Advisory note
    if (rowY + 24 < contentBottom) {
      doc.y = rowY + 10;
      doc
        .fillColor(TEXT_MUTED)
        .font("Helvetica-Oblique")
        .fontSize(8)
        .text(
          "Critical and High findings represent material risk to operations and compliance posture. " +
          "Prioritize remediation before the next scheduled review.",
          margin, doc.y,
          { width: contentW, lineGap: 1 }
        );
    }
  }

  // ─── Page 6: 90-Day Review — the proof-of-action story ──────────────────────
  // Trend + decisions made, sourced from posture history and the immutable
  // lifecycle event streams. This is the section a board actually asks for:
  // are we improving, and what did we decide?

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("90-Day Review — Posture Trend & Decisions", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(1.2);

  // Posture trend line
  const curScore   = data.posture?.overall_score ?? null;
  const priorScore = data.posture_prior?.overall_score ?? null;
  if (curScore !== null && priorScore !== null) {
    // Scores are health-style (higher = better): a positive delta is an
    // improvement. Wording is deterministic ASCII — no arrows or symbols that
    // fall outside the PDF font's WinAnsi encoding and render as mojibake.
    const delta = curScore - priorScore;
    const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : TEXT_MUTED;
    const deltaLabel =
      delta > 0 ? `increased by ${delta} points`
      : delta < 0 ? `decreased by ${Math.abs(delta)} points`
      : "no change";
    doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(11)
      .text("Posture Trend", margin, doc.y);
    doc.moveDown(0.3);
    doc.fillColor(TEXT_MUTED).font("Helvetica-Oblique").fontSize(8)
      .text("Posture is a 0-100 health score — higher = better.", margin, doc.y, { width: contentW });
    doc.moveDown(0.4);
    doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(10)
      .text(
        `Current posture ${curScore}/100 (${fmtDate(data.posture?.snapshot_date)}) vs ` +
        `${priorScore}/100 (${fmtDate(data.posture_prior?.snapshot_date)}):  `,
        margin, doc.y, { continued: true }
      )
      .fillColor(deltaColor).font("Helvetica-Bold")
      .text(deltaLabel);
    doc.moveDown(1);
  } else {
    doc.fillColor(TEXT_MUTED).font("Helvetica-Oblique").fontSize(9)
      .text(
        "Posture trend requires at least two snapshots — the comparison appears once the program has history.",
        margin, doc.y, { width: contentW }
      );
    doc.moveDown(1);
  }

  // Decisions & progress stat rows
  doc.fillColor(TEXT_PRIMARY).font("Helvetica-Bold").fontSize(11)
    .text(`Decisions & Progress (last ${data.period.days} days)`, margin, doc.y);
  doc.rect(margin, doc.y + 4, contentW, 1).fill(RULE_COLOR);
  doc.moveDown(0.8);

  const periodRows: Array<{ label: string; value: number; color: string }> = [
    { label: "Findings closed (governance decision)",     value: data.period.findings_closed,        color: GREEN },
    { label: "Remediations completed",                    value: data.period.findings_remediated,    color: GREEN },
    { label: "Risks formally accepted (findings)",        value: data.period.findings_risk_accepted, color: AMBER },
    { label: "Findings reopened",                         value: data.period.findings_reopened,      color: data.period.findings_reopened > 0 ? RED : TEXT_MUTED },
    { label: "New findings identified",                   value: data.period.findings_new,           color: TEXT_PRIMARY },
    { label: "Register risks closed",                     value: data.period.risks_closed,           color: GREEN },
    { label: "Risk treatments approved",                  value: data.period.risk_approvals,         color: TEXT_PRIMARY },
  ];
  let pry = doc.y;
  for (const row of periodRows) {
    doc.rect(margin, pry, contentW, 18).fill(periodRows.indexOf(row) % 2 === 0 ? LIGHT_BG : WHITE);
    doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(9)
      .text(row.label, margin + 6, pry + 5, { width: contentW - 70, lineBreak: false });
    doc.fillColor(row.color).font("Helvetica-Bold").fontSize(10)
      .text(String(row.value), margin, pry + 4, { width: contentW - 8, align: "right", lineBreak: false });
    pry += 18;
  }
  doc.y = pry + 12;

  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text(
      "Every decision above is backed by an append-only lifecycle event with actor and timestamp " +
      "(finding and risk lifecycle streams). The full trail is exportable for audit.",
      margin, doc.y,
      { width: contentW, lineGap: 1 }
    );

  // ─── Footer stamp on all pages ────────────────────────────────────────────────
  // stampFooters zeroes the bottom margin while writing so footer text cannot
  // trigger pdfkit's implicit page break (footer-only artifact pages, REP-3).

  stampFooters(doc, {
    leftText:  "SecureLogic AI — Confidential",
    textColor: TEXT_MUTED,
    ruleColor: RULE_COLOR,
  });

  doc.end();
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get(
  "/reports/executive.pdf",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId      = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    let data: ExecReportData;
    try {
      data = await withTenant(organizationId, () => assembleExecReport(organizationId));
    } catch (err) {
      logger.error({ event: "executive_report_assembly_failed", err }, "executive report assembly failed");
      res.status(500).json({ error: "executive_report_failed" });
      return;
    }

    const fileDate = new Date().toISOString().slice(0, 10);
    const filename = `executive-report-${safeFilename(data.org_name)}-${fileDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    try {
      generateExecutivePDF(data, res);
    } catch (err) {
      logger.error({ event: "executive_report_pdf_failed", err }, "executive report PDF generation failed");
    }
  }
);

export default router;
