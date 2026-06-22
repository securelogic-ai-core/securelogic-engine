/**
 * gapReport.ts — SOC 2 Gap Analysis PDF Report
 *
 * Produces a management-level PDF gap report for a compliance framework:
 * executive summary, full requirements coverage table grouped by category,
 * per-gap remediation guidance, and open findings summary.
 *
 * Routes:
 *   GET /api/frameworks/:frameworkId/gap-report.pdf
 */

import { Router } from "express";
import type { Response } from "express";
import PDFDocument from "pdfkit";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// ─── Color palette ─────────────────────────────────────────────────────────────

const TEAL          = "#00C4B4";
const SLATE         = "#334155";
const RED           = "#EF4444";
const AMBER         = "#F59E0B";
const GREEN         = "#22C55E";
const LIGHT_BG      = "#F8FAFC";
const RULE_COLOR    = "#CBD5E1";
const TEXT_PRIMARY  = "#0F172A";
const TEXT_MUTED    = "#64748B";
const WHITE         = "#FFFFFF";

// ─── SOC 2 category labels ─────────────────────────────────────────────────────

const CATEGORY_NAMES: Record<string, string> = {
  CC1: "Control Environment",
  CC2: "Information and Communication",
  CC3: "Risk Assessment",
  CC4: "Monitoring Activities",
  CC5: "Control Activities",
  CC6: "Logical and Physical Access Controls",
  CC7: "System Operations",
  CC8: "Change Management",
  CC9: "Risk Mitigation",
  A1:  "Availability",
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type GapControl = {
  control_id:               string;
  control_name:             string;
  latest_assessment_status: string | null;
  is_overdue:               boolean;
};

type GapReason = "unassessed" | "failing" | "overdue";

type GapRequirement = {
  id:           string;
  reference_id: string;
  title:        string;
  status:       "satisfied" | "partial" | "unmapped";
  controls:     GapControl[];
  gap_reason:   GapReason | null;
};

type FindingCount = {
  severity: string;
  count:    number;
};

type GapReportData = {
  generated_at:          string;
  org_name:              string;
  framework:             { id: string; name: string; version: string };
  readiness_score:       number;
  total_requirements:    number;
  satisfied:             number;
  partial:               number;
  unmapped:              number;
  total_mapped_controls: number;
  requirements:          GapRequirement[];
  findings_by_severity:  FindingCount[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function getCategory(referenceId: string): string {
  return referenceId.split(".")[0] ?? referenceId;
}

function deriveGapReason(controls: GapControl[]): GapReason {
  const hasFailing = controls.some(
    (c) =>
      c.latest_assessment_status === "failed" ||
      c.latest_assessment_status === "remediation_required"
  );
  if (hasFailing) return "failing";
  if (controls.some((c) => c.is_overdue)) return "overdue";
  return "unassessed";
}

// ─── Data assembly ─────────────────────────────────────────────────────────────

async function assembleGapReport(
  organizationId: string,
  frameworkId:    string
): Promise<GapReportData | null> {

  // 1. Framework metadata + org name
  const frameworkResult = await pg.query<{
    id: string; name: string; version: string; org_name: string;
  }>(
    `SELECT f.id, f.name, f.version, o.name AS org_name
     FROM frameworks f
     JOIN organizations o ON o.id = f.organization_id
     WHERE f.id = $1 AND f.organization_id = $2`,
    [frameworkId, organizationId]
  );

  if ((frameworkResult.rowCount ?? 0) === 0) return null;
  const fw = frameworkResult.rows[0]!;

  // 2. All requirements for this framework
  const requirementsResult = await pg.query<{
    id: string; reference_id: string; title: string;
  }>(
    `SELECT id, reference_id, title
     FROM requirements
     WHERE framework_id = $1
     ORDER BY created_at ASC, id ASC`,
    [frameworkId]
  );

  const requirements = requirementsResult.rows;

  // 3. Control mappings + open findings (parallel)
  const reqIds = requirements.map((r) => r.id);

  const [mappingsResult, findingsResult] = await Promise.all([
    reqIds.length > 0
      ? pg.query<{ requirement_id: string; control_id: string; control_name: string }>(
          `SELECT cm.requirement_id, cm.control_id, c.name AS control_name
           FROM control_mappings cm
           JOIN controls c ON c.id = cm.control_id
           WHERE cm.requirement_id = ANY($1::uuid[])
             AND c.organization_id = $2`,
          [reqIds, organizationId]
        )
      : Promise.resolve({ rows: [] as Array<{ requirement_id: string; control_id: string; control_name: string }> }),

    pg.query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*)::text AS count
       FROM findings
       WHERE organization_id = $1
         AND status IN ('open', 'in_progress')
       GROUP BY severity
       ORDER BY CASE severity
         WHEN 'Critical' THEN 1 WHEN 'High'     THEN 2
         WHEN 'Moderate' THEN 3 WHEN 'Low'      THEN 4
         ELSE 5 END`,
      [organizationId]
    ),
  ]);

  // Build requirement → controls map
  const mappingsByReq = new Map<string, Array<{ control_id: string; control_name: string }>>();
  for (const row of mappingsResult.rows) {
    const existing = mappingsByReq.get(row.requirement_id) ?? [];
    existing.push({ control_id: row.control_id, control_name: row.control_name });
    mappingsByReq.set(row.requirement_id, existing);
  }

  const allControlIds = [...new Set(mappingsResult.rows.map((r) => r.control_id))];

  // 4. Assessment status + overdue per control (parallel)
  const latestStatusByControl = new Map<string, string>();
  const overdueByControl      = new Map<string, boolean>();

  if (allControlIds.length > 0) {
    const [assessmentsResult, controlsResult] = await Promise.all([
      pg.query<{ control_id: string; latest_status: string }>(
        `SELECT DISTINCT ON (ca.control_id)
           ca.control_id, ca.status AS latest_status
         FROM control_assessments ca
         WHERE ca.control_id = ANY($1::uuid[])
           AND ca.organization_id = $2
         ORDER BY ca.control_id, ca.created_at DESC, ca.id DESC`,
        [allControlIds, organizationId]
      ),
      pg.query<{ id: string; is_overdue: boolean }>(
        `SELECT id,
           (next_test_due IS NOT NULL
            AND next_test_due < CURRENT_DATE
            AND testing_frequency IS NOT NULL
            AND testing_frequency != 'ad_hoc'
           ) AS is_overdue
         FROM controls
         WHERE id = ANY($1::uuid[])
           AND organization_id = $2`,
        [allControlIds, organizationId]
      ),
    ]);

    for (const row of assessmentsResult.rows) {
      latestStatusByControl.set(row.control_id, row.latest_status);
    }
    for (const row of controlsResult.rows) {
      overdueByControl.set(row.id, row.is_overdue);
    }
  }

  // 5. Classify requirements
  let satisfied = 0;
  let partial   = 0;
  let unmapped  = 0;

  const gapRequirements: GapRequirement[] = requirements.map((req) => {
    const controlMappings = mappingsByReq.get(req.id) ?? [];

    const controls: GapControl[] = controlMappings.map((cm) => ({
      control_id:               cm.control_id,
      control_name:             cm.control_name,
      latest_assessment_status: latestStatusByControl.get(cm.control_id) ?? null,
      is_overdue:               overdueByControl.get(cm.control_id) ?? false,
    }));

    let status:     "satisfied" | "partial" | "unmapped";
    let gap_reason: GapReason | null = null;

    if (controls.length === 0) {
      status = "unmapped";
      unmapped++;
    } else {
      const hasPassedFresh = controls.some(
        (c) => c.latest_assessment_status === "passed" && !c.is_overdue
      );
      if (hasPassedFresh) {
        status = "satisfied";
        satisfied++;
      } else {
        status = "partial";
        partial++;
        gap_reason = deriveGapReason(controls);
      }
    }

    return { id: req.id, reference_id: req.reference_id, title: req.title, status, controls, gap_reason };
  });

  const total         = requirements.length;
  const readiness_score   = total === 0 ? 0 : Math.round((satisfied / total) * 100);
  const total_mapped_controls = allControlIds.length;

  return {
    generated_at:         new Date().toISOString(),
    org_name:             fw.org_name,
    framework:            { id: fw.id, name: fw.name, version: fw.version },
    readiness_score,
    total_requirements:   total,
    satisfied,
    partial,
    unmapped,
    total_mapped_controls,
    requirements:         gapRequirements,
    findings_by_severity: findingsResult.rows.map((r) => ({
      severity: r.severity,
      count:    parseInt(r.count, 10),
    })),
  };
}

// ─── PDF generation ────────────────────────────────────────────────────────────

function generateGapReportPDF(data: GapReportData, res: Response): void {
  const doc = new PDFDocument({
    margin:      50,
    size:        "A4",
    bufferPages: true,
    info: {
      Title:   `SOC 2 Gap Analysis — ${data.org_name}`,
      Author:  "SecureLogic AI",
      Subject: "SOC 2 Type II Gap Analysis",
    },
  });

  doc.pipe(res);

  const pageW          = doc.page.width;    // 595.28
  const pageH          = doc.page.height;   // 841.89
  const margin         = 50;
  const contentW       = pageW - margin * 2;
  const contentBottom  = pageH - 50;        // reserve footer zone

  // ─── Page 1: Cover ───────────────────────────────────────────────────────────

  // Top accent bar
  doc.rect(0, 0, pageW, 8).fill(TEAL);

  // Logo
  doc
    .fillColor(TEAL)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("SecureLogic AI", margin, 80, { width: contentW });
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(10)
    .text("Security Intelligence Platform", margin, 104, { width: contentW });

  // Main title block
  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text("SOC 2 Type II Gap Analysis", margin, 200, { width: contentW });
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(16)
    .text(data.org_name, margin, 240, { width: contentW });

  // Horizontal rule
  doc.rect(margin, 280, contentW, 1).fill(RULE_COLOR);

  // Report info block
  const infoItems: Array<[string, string, boolean]> = [
    ["Framework",    `${data.framework.name} ${data.framework.version}`, false],
    ["Report Date",  fmtDate(data.generated_at),                         false],
    ["Generated by", "SecureLogic AI",                                   false],
    ["Status",       "CONFIDENTIAL",                                      true],
  ];

  let infoY = 320;
  for (const [label, value, highlight] of infoItems) {
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(10)
      .text(`${label}:`, margin, infoY, { width: 100, lineBreak: false });
    doc
      .fillColor(highlight ? RED : TEXT_PRIMARY)
      .font(highlight ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .text(value, margin + 100, infoY, { width: contentW - 100, lineBreak: false });
    infoY += 20;
  }

  // Confidentiality notice
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text(
      "This document contains confidential security assessment information. " +
      "Distribution should be limited to authorized personnel only.",
      margin, 680,
      { width: contentW, align: "center" }
    );

  // ─── Page 2: Executive Summary ────────────────────────────────────────────────

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Executive Summary", margin, margin);
  doc.rect(margin, doc.y + 4, contentW, 1.5).fill(TEAL);
  doc.moveDown(1.2);

  // Stat boxes — 2×2 grid
  const gap    = 16;
  const boxW   = (contentW - gap) / 2;
  const boxH   = 80;
  const gridTop = doc.y;
  const gapCount = data.partial + data.unmapped;

  const boxes = [
    {
      value: `${data.readiness_score}%`,
      label: "Readiness Score",
      sub:   data.readiness_score >= 70 ? "Good coverage" : "Needs improvement",
      color: scoreColor(data.readiness_score),
    },
    {
      value: `${data.satisfied} / ${data.total_requirements}`,
      label: "Requirements Met",
      sub:   "Fully satisfied",
      color: GREEN,
    },
    {
      value: String(gapCount),
      label: "Gaps Identified",
      sub:   "Require attention",
      color: gapCount > 0 ? RED : GREEN,
    },
    {
      value: String(data.total_mapped_controls),
      label: "Controls Mapped",
      sub:   "Across all requirements",
      color: TEXT_PRIMARY,
    },
  ];

  boxes.forEach((box, i) => {
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

  // Advance past the grid
  doc.y = gridTop + 2 * (boxH + gap) + 20;

  // Assessment summary paragraph
  const summaryText =
    `As of ${fmtDate(data.generated_at)}, ${data.org_name} has achieved ${data.readiness_score}% ` +
    `readiness against ${data.framework.name} ${data.framework.version} requirements. ` +
    `${data.satisfied} of ${data.total_requirements} requirements are fully satisfied by mapped ` +
    `and assessed controls. ` +
    `${gapCount} requirement${gapCount !== 1 ? "s have" : " has"} been identified as ` +
    `gap${gapCount !== 1 ? "s" : ""} requiring immediate or near-term remediation.`;

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica")
    .fontSize(9)
    .text(summaryText, margin, doc.y, { width: contentW, lineGap: 2 });

  doc.moveDown(1.2);

  // Risk level box
  let riskLabel:  string;
  let riskDetail: string;
  let riskColor:  string;
  if (data.readiness_score >= 80) {
    riskLabel  = "LOW RISK";
    riskDetail = "Minor gaps only. Organization demonstrates strong control coverage.";
    riskColor  = GREEN;
  } else if (data.readiness_score >= 60) {
    riskLabel  = "MODERATE RISK";
    riskDetail = "Several gaps require attention before audit readiness.";
    riskColor  = AMBER;
  } else if (data.readiness_score >= 40) {
    riskLabel  = "ELEVATED RISK";
    riskDetail = "Significant control gaps exist. Remediation required before SOC 2 audit.";
    riskColor  = AMBER;
  } else {
    riskLabel  = "HIGH RISK";
    riskDetail = "Major coverage gaps. SOC 2 audit readiness is not achievable without substantial remediation.";
    riskColor  = RED;
  }

  const riskBoxY = doc.y;
  doc.roundedRect(margin, riskBoxY, contentW, 46, 6).stroke(riskColor);
  doc
    .fillColor(riskColor)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(riskLabel, margin + 14, riskBoxY + 10, { width: contentW - 28, lineBreak: false });
  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(riskDetail, margin + 14, riskBoxY + 26, { width: contentW - 28, lineBreak: false });

  // ─── Page 3+: Requirements Summary Table ──────────────────────────────────────

  doc.addPage();

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Requirements Summary", margin, margin);

  const tblRuleY = doc.y + 4;
  doc.rect(margin, tblRuleY, contentW, 1.5).fill(TEAL);

  // Column layout
  const colRef    = 45;
  const colStatus = 72;
  const colCtrl   = 68;
  const colTitle  = contentW - colRef - colStatus - colCtrl;

  const xRef    = margin;
  const xTitle  = margin + colRef;
  const xStatus = margin + colRef + colTitle;
  const xCtrl   = margin + colRef + colTitle + colStatus;

  const headerH  = 20;
  const catRowH  = 16;
  const dataRowH = 15;

  let tableY = tblRuleY + 1.5 + 12;

  function drawTableHeader(y: number): void {
    doc.rect(margin, y, contentW, headerH).fill(SLATE);
    const ty = y + 6;
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("REF",         xRef,    ty, { width: colRef    - 2, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("REQUIREMENT", xTitle,  ty, { width: colTitle  - 4, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("STATUS",      xStatus, ty, { width: colStatus - 4, lineBreak: false });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("CONTROLS",   xCtrl,   ty, { width: colCtrl   - 2, lineBreak: false });
  }

  drawTableHeader(tableY);
  tableY += headerH;

  // Group by category, preserving insertion order
  const categories = new Map<string, GapRequirement[]>();
  for (const req of data.requirements) {
    const cat = getCategory(req.reference_id);
    const existing = categories.get(cat) ?? [];
    existing.push(req);
    categories.set(cat, existing);
  }

  let rowIndex = 0;

  for (const [cat, catReqs] of categories) {
    const catName  = CATEGORY_NAMES[cat] ?? cat;
    const catLabel = `${cat} — ${catName}  (${catReqs.length} req${catReqs.length !== 1 ? "s" : ""})`;

    // Overflow check for category row
    if (tableY + catRowH > contentBottom - 10) {
      doc.addPage();
      tableY = margin;
      drawTableHeader(tableY);
      tableY += headerH;
    }

    doc.rect(margin, tableY, contentW, catRowH).fill("#EFF6FF");
    doc
      .fillColor(TEXT_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(catLabel, margin + 6, tableY + 4, { width: contentW - 12, lineBreak: false });
    tableY += catRowH;

    for (const req of catReqs) {
      if (tableY + dataRowH > contentBottom - 10) {
        doc.addPage();
        tableY = margin;
        drawTableHeader(tableY);
        tableY += headerH;
      }

      const rowBg = rowIndex % 2 === 0 ? WHITE : LIGHT_BG;
      doc.rect(margin, tableY, contentW, dataRowH).fill(rowBg);

      const ty = tableY + 3;

      doc.fillColor(TEAL).font("Courier-Bold").fontSize(8)
        .text(req.reference_id, xRef, ty, { width: colRef - 2, lineBreak: false });

      doc.fillColor(TEXT_PRIMARY).font("Helvetica").fontSize(8)
        .text(req.title, xTitle + 2, ty, { width: colTitle - 6, lineBreak: false });

      let statusText:  string;
      let statusColor: string;
      if (req.status === "satisfied") {
        statusText  = "\u2713 Satisfied";
        statusColor = GREEN;
      } else if (req.status === "partial") {
        statusText  = "~ Partial";
        statusColor = AMBER;
      } else {
        statusText  = "\u2717 Gap";
        statusColor = RED;
      }
      doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(8)
        .text(statusText, xStatus + 2, ty, { width: colStatus - 4, lineBreak: false });

      const ctrlCount = req.controls.length;
      const ctrlText  = ctrlCount === 0 ? "None" : `${ctrlCount} ctrl${ctrlCount !== 1 ? "s" : ""}`;
      doc.fillColor(ctrlCount === 0 ? TEXT_MUTED : TEXT_PRIMARY).font("Helvetica").fontSize(8)
        .text(ctrlText, xCtrl + 2, ty, { width: colCtrl - 4, lineBreak: false });

      tableY += dataRowH;
      rowIndex++;
    }
  }

  // ─── Gap Details ──────────────────────────────────────────────────────────────

  const gaps: GapRequirement[] = [
    ...data.requirements.filter((r) => r.status === "unmapped"),
    ...data.requirements.filter((r) => r.status === "partial"),
  ];

  if (gaps.length > 0) {
    doc.addPage();
    let gapY = margin;

    doc
      .fillColor(TEXT_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Gap Details", margin, gapY);
    const gapRuleY = doc.y + 4;
    doc.rect(margin, gapRuleY, contentW, 1.5).fill(TEAL);
    gapY = gapRuleY + 1.5 + 14;

    for (const req of gaps) {
      const isUnmapped  = req.status === "unmapped";
      const ctrlCount   = req.controls.length;
      // Estimate minimum height needed for this section
      const estH = 24 + 16 + 14 + (ctrlCount * 13) + 28 + 20;

      if (gapY + Math.max(estH, 90) > contentBottom - 10 && gapY > margin + 80) {
        doc.addPage();
        gapY = margin;
      }

      // Priority badge (top right)
      const isPriorityHigh =
        isUnmapped || req.gap_reason === "failing";
      const priorityLabel  = isPriorityHigh ? "HIGH PRIORITY" : "MEDIUM PRIORITY";
      const priorityColor  = isPriorityHigh ? RED : AMBER;

      doc
        .fillColor(priorityColor)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(priorityLabel, margin, gapY, {
          width: contentW, align: "right", lineBreak: false,
        });

      // Status badge (filled pill)
      const badgeW  = 50;
      const badgeH  = 13;
      const badgeBg = isUnmapped ? RED : AMBER;
      const badgeTx = isUnmapped ? "GAP" : "PARTIAL";
      doc.roundedRect(margin, gapY, badgeW, badgeH, 3).fill(badgeBg);
      doc
        .fillColor(WHITE)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(badgeTx, margin + 2, gapY + 3, {
          width: badgeW - 4, align: "center", lineBreak: false,
        });

      gapY += badgeH + 5;

      // Reference ID + title
      doc
        .fillColor(TEAL)
        .font("Courier-Bold")
        .fontSize(9)
        .text(req.reference_id, margin, gapY, { continued: true });
      doc
        .fillColor(TEXT_PRIMARY)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(`  ${req.title}`, { width: contentW - 20 });
      gapY = doc.y + 4;

      // Gap reason explanation
      let reasonText: string;
      if (isUnmapped) {
        reasonText =
          "No controls have been mapped to this requirement. This represents a complete coverage gap.";
      } else if (req.gap_reason === "failing") {
        reasonText =
          "Controls are mapped to this requirement but one or more controls have failed their most recent assessment.";
      } else if (req.gap_reason === "overdue") {
        reasonText =
          "Controls are mapped to this requirement but one or more controls are overdue for testing.";
      } else {
        reasonText =
          "Controls are mapped to this requirement but none have been assessed.";
      }

      doc
        .fillColor(TEXT_MUTED)
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text(reasonText, margin + 8, gapY, { width: contentW - 8, lineGap: 1 });
      gapY = doc.y + 6;

      // Mapped controls list (partial only)
      if (!isUnmapped && req.controls.length > 0) {
        for (const ctrl of req.controls) {
          if (gapY + 13 > contentBottom - 10) {
            doc.addPage();
            gapY = margin;
          }

          const aStatus = ctrl.latest_assessment_status;
          let aColor: string;
          if (aStatus === "passed") {
            aColor = GREEN;
          } else if (aStatus === "failed" || aStatus === "remediation_required") {
            aColor = RED;
          } else if (aStatus === "in_progress") {
            aColor = TEAL;
          } else {
            aColor = TEXT_MUTED;
          }

          const aLabel     = aStatus ? aStatus.replace(/_/g, " ") : "not assessed";
          const overdueTag = ctrl.is_overdue ? " (overdue)" : "";

          doc
            .fillColor(TEXT_PRIMARY)
            .font("Helvetica")
            .fontSize(9)
            .text(`\u2022  ${ctrl.control_name}`, margin + 14, gapY, {
              width: contentW * 0.55, lineBreak: false,
            });

          doc
            .fillColor(aColor)
            .font("Helvetica")
            .fontSize(9)
            .text(`${aLabel}${overdueTag}`, margin + contentW * 0.55 + 14, gapY, {
              width: contentW * 0.45 - 14, align: "right", lineBreak: false,
            });

          gapY += 13;
        }
        gapY += 4;
      }

      // Remediation guidance
      if (gapY + 28 > contentBottom - 10) {
        doc.addPage();
        gapY = margin;
      }

      let guidanceText: string;
      if (isUnmapped) {
        guidanceText =
          "Define and implement controls that satisfy this requirement. " +
          "Map those controls to this requirement in SecureLogic AI to track coverage.";
      } else if (req.gap_reason === "failing") {
        guidanceText =
          "Review and remediate the failing controls. " +
          "Update assessments once controls are brought into compliance.";
      } else if (req.gap_reason === "overdue") {
        guidanceText =
          "Schedule and complete overdue control testing to confirm current compliance status.";
      } else {
        guidanceText =
          "Complete an assessment of the mapped controls to establish whether they satisfy this requirement.";
      }

      doc
        .fillColor(TEXT_MUTED)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("Remediation: ", margin + 8, gapY, { continued: true });
      doc
        .fillColor(TEXT_MUTED)
        .font("Helvetica")
        .fontSize(8)
        .text(guidanceText, { width: contentW - 16, lineGap: 1 });
      gapY = doc.y + 8;

      // Separator
      if (gapY + 2 < contentBottom - 10) {
        doc.rect(margin, gapY, contentW, 0.5).fill(RULE_COLOR);
        gapY += 14;
      }
    }
  }

  // ─── Final Page: Open Findings Summary ───────────────────────────────────────

  doc.addPage();
  let findY = margin;

  doc
    .fillColor(TEXT_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Open Security Findings", margin, findY);
  const findRuleY = doc.y + 4;
  doc.rect(margin, findRuleY, contentW, 1.5).fill(TEAL);
  findY = findRuleY + 1.5 + 12;

  doc
    .fillColor(TEXT_MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text("Active findings that may affect SOC 2 compliance.", margin, findY, { width: contentW });
  findY = doc.y + 20;

  const totalFindings = data.findings_by_severity.reduce((s, f) => s + f.count, 0);

  if (totalFindings === 0) {
    doc
      .fillColor(GREEN)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("No open findings. Good posture.", margin, findY, { width: contentW });
  } else {
    const maxCount  = Math.max(...data.findings_by_severity.map((f) => f.count));
    const barMaxW   = contentW - 130;

    const sevColors: Record<string, string> = {
      Critical: RED,
      High:     "#F97316",
      Moderate: AMBER,
      Low:      "#84CC16",
    };

    for (const finding of data.findings_by_severity) {
      if (findY + 22 > contentBottom - 30) break;

      const barW   = Math.max(3, Math.round((finding.count / maxCount) * barMaxW));
      const sColor = sevColors[finding.severity] ?? TEXT_MUTED;

      doc
        .fillColor(TEXT_PRIMARY)
        .font("Helvetica")
        .fontSize(9)
        .text(finding.severity, margin, findY + 3, { width: 72, lineBreak: false });

      doc.roundedRect(margin + 76, findY, barW, 14, 2).fill(sColor);

      doc
        .fillColor(TEXT_PRIMARY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(String(finding.count), margin + 76 + barW + 8, findY + 3, {
          width: 40, lineBreak: false,
        });

      findY += 22;
    }

    findY += 16;

    if (findY < contentBottom - 30) {
      doc
        .fillColor(TEXT_MUTED)
        .font("Helvetica-Oblique")
        .fontSize(8)
        .text(
          "Open findings should be reviewed and remediated prior to SOC 2 audit. " +
          "Critical and High findings in particular represent material risk to audit outcomes.",
          margin, findY,
          { width: contentW, lineGap: 1 }
        );
    }
  }

  // ─── Stamp footers on all pages ───────────────────────────────────────────────

  const range      = (doc as any).bufferedPageRange() as { start: number; count: number };
  const totalPages = range.count;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    const footerY = pageH - 28;
    doc.rect(margin, footerY - 8, contentW, 0.5).fill(RULE_COLOR);
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text("SecureLogic AI \u2014 Confidential", margin, footerY, {
        width: contentW / 2, lineBreak: false,
      });
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(`Page ${i + 1} of ${totalPages}`, margin + contentW / 2, footerY, {
        width: contentW / 2, align: "right", lineBreak: false,
      });
  }

  doc.end();
}

// ─── Route ─────────────────────────────────────────────────────────────────────

router.get(
  "/frameworks/:frameworkId/gap-report.pdf",
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

    const frameworkId = String(req.params["frameworkId"] ?? "").trim();
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    let data: GapReportData | null;
    try {
      data = await assembleGapReport(organizationId, frameworkId);
    } catch (err) {
      logger.error({ event: "gap_report_assembly_failed", err }, "gap report assembly failed");
      res.status(500).json({ error: "gap_report_failed" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "framework_not_found" });
      return;
    }

    const fileDate = new Date().toISOString().slice(0, 10);
    const filename = `soc2-gap-report-${safeFilename(data.org_name)}-${fileDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    try {
      generateGapReportPDF(data, res);
    } catch (err) {
      logger.error({ event: "gap_report_pdf_failed", err }, "gap report PDF generation failed");
    }
  }
);

export default router;
