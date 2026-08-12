/**
 * auditPackage.ts — Framework audit readiness package
 *
 * Assembles a complete audit package for a framework: requirements,
 * mapped controls, latest assessment data, and attached evidence.
 * Serves both a structured JSON response and a PDF download.
 *
 * Routes:
 *   GET /api/frameworks/:id/audit-package
 *   GET /api/frameworks/:id/audit-package.pdf
 */

import { Router } from "express";
import PDFDocument from "pdfkit";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { readinessScore, coverageCaption } from "../lib/frameworkCoverage.js";
import { secureLogicLogo, stampFooters, inFooterZone } from "../lib/reportBranding.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EvidenceItem = {
  id: string;
  title: string;
  evidence_type: string;
  description: string | null;
  collected_at: string | null;
  collected_by: string | null;
  external_ref: string | null;
};

type AuditControl = {
  control_id: string;
  control_name: string;
  assessment_id: string | null;
  assessment_status: string | null;
  overall_severity: string | null;
  assessment_summary: string | null;
  performed_at: string | null;
  evidence: EvidenceItem[];
};

type AuditRequirement = {
  id: string;
  reference_id: string;
  title: string;
  status: "satisfied" | "partial" | "unmapped";
  controls: AuditControl[];
};

export type AuditPackage = {
  generated_at: string;
  organization: { name: string };
  framework: { id: string; name: string; version: string };
  readiness_summary: {
    readiness_score: number;
    total_requirements: number;
    satisfied: number;
    partial: number;
    unmapped: number;
  };
  requirements: AuditRequirement[];
};

// ─── Assembly logic ───────────────────────────────────────────────────────────

async function assembleAuditPackage(
  organizationId: string,
  frameworkId: string
): Promise<AuditPackage | null> {
  // Step 1: Verify framework belongs to org
  const frameworkResult = await pg.query<{
    id: string; name: string; version: string;
  }>(
    `SELECT id, name, version FROM frameworks WHERE id = $1 AND organization_id = $2`,
    [frameworkId, organizationId]
  );

  if ((frameworkResult.rowCount ?? 0) === 0) return null;
  const framework = frameworkResult.rows[0]!;

  // Step 2: Get org name
  const orgResult = await pg.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const orgName = orgResult.rows[0]?.name ?? "Unknown Organization";

  // Step 3: Get all requirements for this framework
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

  if (requirements.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      organization: { name: orgName },
      framework: { id: framework.id, name: framework.name, version: framework.version },
      readiness_summary: {
        readiness_score: 0,
        total_requirements: 0,
        satisfied: 0,
        partial: 0,
        unmapped: 0,
      },
      requirements: [],
    };
  }

  const requirementIds = requirements.map((r) => r.id);

  // Step 4: Get all mapped controls with their latest assessments in one query.
  // LATERAL JOIN fetches only the most recent assessment per control.
  const controlsResult = await pg.query<{
    requirement_id: string;
    control_id: string;
    control_name: string;
    assessment_id: string;
    assessment_status: string;
    overall_severity: string | null;
    assessment_summary: string | null;
    performed_at: string | null;
  }>(
    `SELECT
       cm.requirement_id,
       cm.control_id,
       c.name AS control_name,
       ca.id AS assessment_id,
       ca.status AS assessment_status,
       ca.overall_severity,
       ca.summary AS assessment_summary,
       ca.performed_at
     FROM control_mappings cm
     JOIN controls c ON c.id = cm.control_id
     JOIN LATERAL (
       SELECT id, status, overall_severity, summary, performed_at
       FROM control_assessments
       WHERE control_id = cm.control_id
         AND organization_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) ca ON true
     WHERE cm.requirement_id = ANY($2::uuid[])
       AND c.organization_id = $1`,
    [organizationId, requirementIds]
  );

  // Also get controls that have mappings but no assessments
  const unmappedControlsResult = await pg.query<{
    requirement_id: string;
    control_id: string;
    control_name: string;
  }>(
    `SELECT cm.requirement_id, cm.control_id, c.name AS control_name
     FROM control_mappings cm
     JOIN controls c ON c.id = cm.control_id
     LEFT JOIN control_assessments ca
       ON ca.control_id = cm.control_id AND ca.organization_id = $1
     WHERE cm.requirement_id = ANY($2::uuid[])
       AND c.organization_id = $1
       AND ca.id IS NULL`,
    [organizationId, requirementIds]
  );

  // Step 5: Get evidence for all assessment IDs
  const assessmentIds = controlsResult.rows.map((r) => r.assessment_id).filter(Boolean);

  const evidenceByAssessment = new Map<string, EvidenceItem[]>();

  if (assessmentIds.length > 0) {
    const evidenceResult = await pg.query<{
      assessment_id: string;
      id: string;
      title: string;
      evidence_type: string;
      description: string | null;
      collected_at: string | null;
      collected_by: string | null;
      external_ref: string | null;
    }>(
      `SELECT
         e.source_id AS assessment_id,
         e.id,
         e.title,
         e.evidence_type,
         e.description,
         e.collected_at,
         e.collected_by,
         e.external_ref
       FROM evidence e
       WHERE e.source_type = 'control_test'
         AND e.source_id = ANY($1::uuid[])
         AND e.organization_id = $2
       ORDER BY e.created_at ASC`,
      [assessmentIds, organizationId]
    );

    for (const row of evidenceResult.rows) {
      const existing = evidenceByAssessment.get(row.assessment_id) ?? [];
      existing.push({
        id: row.id,
        title: row.title,
        evidence_type: row.evidence_type,
        description: row.description,
        collected_at: row.collected_at,
        collected_by: row.collected_by,
        external_ref: row.external_ref,
      });
      evidenceByAssessment.set(row.assessment_id, existing);
    }
  }

  // Step 6: Build control maps per requirement
  const controlsByRequirement = new Map<string, AuditControl[]>();

  // Add controls with assessments
  for (const row of controlsResult.rows) {
    const existing = controlsByRequirement.get(row.requirement_id) ?? [];
    existing.push({
      control_id: row.control_id,
      control_name: row.control_name,
      assessment_id: row.assessment_id,
      assessment_status: row.assessment_status,
      overall_severity: row.overall_severity,
      assessment_summary: row.assessment_summary,
      performed_at: row.performed_at,
      evidence: evidenceByAssessment.get(row.assessment_id) ?? [],
    });
    controlsByRequirement.set(row.requirement_id, existing);
  }

  // Add controls without assessments (mapped but never assessed)
  for (const row of unmappedControlsResult.rows) {
    const existing = controlsByRequirement.get(row.requirement_id) ?? [];
    // Only add if not already present from the assessed controls query
    if (!existing.some((c) => c.control_id === row.control_id)) {
      existing.push({
        control_id: row.control_id,
        control_name: row.control_name,
        assessment_id: null,
        assessment_status: null,
        overall_severity: null,
        assessment_summary: null,
        performed_at: null,
        evidence: [],
      });
    }
    controlsByRequirement.set(row.requirement_id, existing);
  }

  // Step 7: Classify requirements and compute readiness
  let satisfiedCount = 0;
  let partialCount = 0;
  let unmappedCount = 0;

  const auditRequirements: AuditRequirement[] = requirements.map((req) => {
    const controls = controlsByRequirement.get(req.id) ?? [];

    let status: "satisfied" | "partial" | "unmapped";
    if (controls.length === 0) {
      status = "unmapped";
      unmappedCount++;
    } else {
      const hasPassed = controls.some((c) => c.assessment_status === "passed");
      if (hasPassed) {
        status = "satisfied";
        satisfiedCount++;
      } else {
        status = "partial";
        partialCount++;
      }
    }

    return {
      id: req.id,
      reference_id: req.reference_id,
      title: req.title,
      status,
      controls,
    };
  });

  const total = requirements.length;
  // Item-7 ruling: satisfied-only, via the one shared coverage rule.
  const readiness_score = readinessScore(satisfiedCount, total);

  return {
    generated_at: new Date().toISOString(),
    organization: { name: orgName },
    framework: { id: framework.id, name: framework.name, version: framework.version },
    readiness_summary: {
      readiness_score,
      total_requirements: total,
      satisfied: satisfiedCount,
      partial: partialCount,
      unmapped: unmappedCount,
    },
    requirements: auditRequirements,
  };
}

// ─── JSON route ───────────────────────────────────────────────────────────────

router.get(
  "/frameworks/:id/audit-package",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    try {
      const pkg = await withTenant(organizationId, () => assembleAuditPackage(organizationId, frameworkId));
      if (!pkg) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }
      res.status(200).json(pkg);
    } catch (err) {
      logger.error({ event: "audit_package_json_failed", err }, "GET audit-package failed");
      res.status(500).json({ error: "audit_package_failed" });
    }
  }
);

// ─── PDF route ────────────────────────────────────────────────────────────────

// PDF color palette
const C = {
  navy:      "#0d1626",
  teal:      "#00c4b4",
  slate:     "#64748b",
  textDark:  "#1e293b",
  textLight: "#f1f5f9",
  green:     "#22c55e",
  amber:     "#f59e0b",
  red:       "#ef4444",
  white:     "#ffffff",
  line:      "#1e2d45",
};

function scoreColor(score: number): string {
  if (score >= 80) return C.green;
  if (score >= 50) return C.amber;
  return C.red;
}

function statusLabel(status: "satisfied" | "partial" | "unmapped"): string {
  if (status === "satisfied") return "SATISFIED";
  if (status === "partial") return "PARTIAL";
  return "UNMAPPED";
}

function statusColor(status: "satisfied" | "partial" | "unmapped"): string {
  if (status === "satisfied") return C.green;
  if (status === "partial") return C.amber;
  return C.slate;
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9_\-]/gi, "-").toLowerCase().slice(0, 40);
}

export function generateAuditPackagePDF(
  pkg: AuditPackage,
  out: NodeJS.WritableStream
): void {
  const { framework, organization, readiness_summary: rs, requirements } = pkg;
  const dateStr = new Date(pkg.generated_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
  doc.pipe(out);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 50;
  const contentW = pageW - margin * 2;

  // ── Page 1: Cover ──────────────────────────────────────────────────────────
  doc.rect(0, 0, pageW, pageH).fill(C.navy);

  // Canonical SecureLogic AI logo (navy background matches the cover); text
  // wordmark only when the asset is unavailable.
  const logo = secureLogicLogo();
  if (logo) {
    doc.image(logo, margin, 48, { width: 84 });
  } else {
    doc
      .fillColor(C.teal)
      .font("Helvetica")
      .fontSize(11)
      .text("SecureLogic AI", margin, 80, { width: contentW, align: "left" });
  }

  doc
    .fillColor(C.textLight)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text(framework.name, margin, 160, { width: contentW });

  doc
    .fillColor(C.slate)
    .font("Helvetica")
    .fontSize(14)
    .text("Audit Readiness Package", margin, doc.y + 8, { width: contentW });

  doc
    .fillColor(C.slate)
    .font("Helvetica")
    .fontSize(11)
    .text(`Version ${framework.version}`, margin, doc.y + 6, { width: contentW });

  doc.moveDown(3);

  doc
    .fillColor(C.textLight)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(organization.name, margin, doc.y, { width: contentW });

  doc
    .fillColor(C.slate)
    .font("Helvetica")
    .fontSize(11)
    .text(`Generated by SecureLogic AI · ${dateStr}`, margin, doc.y + 6, { width: contentW });

  // Bottom teal bar + cover confidentiality line. Written inside the bottom
  // margin zone, so it must run under inFooterZone or pdfkit inserts an
  // artifact page after the cover (staging REP-3).
  doc.rect(0, pageH - 36, pageW, 1).fill(C.teal);
  inFooterZone(doc, () => {
    doc
      .fillColor(C.slate)
      .font("Helvetica")
      .fontSize(9)
      .text("CONFIDENTIAL", margin, pageH - 28, {
        width: contentW, align: "center", lineBreak: false,
      });
  });

  // ── Page 2: Executive Summary ──────────────────────────────────────────────
  doc.addPage();

  doc
    .fillColor(C.textDark)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("Executive Summary", margin, margin);

  doc.rect(margin, doc.y + 4, contentW, 2).fill(C.teal);
  doc.moveDown(1.5);

  // Stat boxes (2x2 grid)
  const boxW = (contentW - 12) / 2;
  const boxH = 52;
  // Item-7 ruling: the score is satisfied-only, so the grid must carry the
  // partial count too — a low score beside visible partial work is only
  // honest when both numbers are on the page. "Fully Satisfied" (not
  // "Satisfied") is the vocabulary the caption uses everywhere.
  const boxes = [
    { label: "Readiness Score", value: `${rs.readiness_score}%`, color: scoreColor(rs.readiness_score) },
    { label: "Total Requirements", value: String(rs.total_requirements), color: C.textDark },
    { label: "Fully Satisfied", value: String(rs.satisfied), color: C.green },
    { label: "Partial / Unmapped", value: `${rs.partial} / ${rs.unmapped}`, color: C.slate },
  ];

  const gridTop = doc.y;
  boxes.forEach((box, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = margin + col * (boxW + 12);
    const by = gridTop + row * (boxH + 8);

    doc.rect(bx, by, boxW, boxH).stroke("#d1d5db");

    doc
      .fillColor(box.color)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(box.value, bx + 12, by + 8, { width: boxW - 24 });

    doc
      .fillColor(C.slate)
      .font("Helvetica")
      .fontSize(9)
      .text(box.label, bx + 12, by + 34, { width: boxW - 24 });
  });

  doc.moveDown(6);

  const summaryPara =
    `This audit readiness package documents ${organization.name}'s compliance posture against the ` +
    `${framework.name} ${framework.version} framework as of ${dateStr}. ` +
    `Of ${rs.total_requirements} requirements: ` +
    `${coverageCaption({ satisfied: rs.satisfied, partial: rs.partial, unmapped: rs.unmapped })} ` +
    `(${rs.readiness_score}% readiness — partially covered requirements earn no score credit).`;

  doc
    .fillColor(C.textDark)
    .font("Helvetica")
    .fontSize(11)
    .text(summaryPara, margin, doc.y, { width: contentW, lineGap: 3 });

  // ── Pages 3+: Requirements ─────────────────────────────────────────────────
  // Page numbers are stamped once at the end by stampFooters (with the real
  // total); writing them inline in the bottom margin is what used to spawn
  // page-number-only artifact pages and drift the numbering.
  //
  // Layout rule for this section (staging REP-4): every write is placed at an
  // explicit y and the flow cursor only ever moves DOWN. pdfkit leaves doc.y
  // below whatever it last wrote — including a write placed back up at the top
  // of the block — so a right-column write must save and restore the cursor.
  // The status badge used to be written at reqTop without restoring, rewinding
  // doc.y to the top of the requirement and stamping the control name,
  // assessment status, summary and evidence straight over the requirement
  // title.

  // The badge owns a fixed right-hand column; requirement text is measured
  // against the remaining width so it can never run underneath the badge.
  const BADGE_W = 80;
  const GUTTER = 10;
  const reqTextW = contentW - BADGE_W - GUTTER;
  const INDENT = 12;
  const ctrlTextW = contentW - INDENT * 2;
  const evTextW = contentW - 32;
  // Content must stop clear of the stamped footer (rule at pageH-36, text at
  // pageH-28) and above pdfkit's own bottom margin, so no block can trigger an
  // implicit, header-less page break.
  const contentBottom = pageH - 56;

  type TextStyle = {
    font: string;
    size: number;
    color: string;
    width: number;
    align?: "left" | "right";
    lineGap?: number;
  };

  function addPageHeader(): number {
    doc.addPage();

    doc
      .fillColor(C.slate)
      .font("Helvetica")
      .fontSize(8)
      .text(`${organization.name} — ${framework.name}`, margin, 20, { width: contentW / 2 })
      .text("CONFIDENTIAL", margin + contentW / 2, 20, { width: contentW / 2, align: "right" });

    doc.rect(margin, 32, contentW, 0.5).fill(C.slate);

    return 44; // y after header
  }

  /** Height this text will occupy in `style`'s box, without drawing it. */
  function measure(text: string, style: TextStyle): number {
    doc.font(style.font).fontSize(style.size);
    return doc.heightOfString(text, { width: style.width, lineGap: style.lineGap ?? 0 });
  }

  /** Draw text at an explicit box; returns the y immediately below it. */
  function writeBlock(text: string, x: number, y: number, style: TextStyle): number {
    doc
      .font(style.font)
      .fontSize(style.size)
      .fillColor(style.color)
      .text(text, x, y, {
        width: style.width,
        align: style.align ?? "left",
        lineGap: style.lineGap ?? 0,
      });
    return doc.y;
  }

  /** Break to a fresh headed page unless `needed` points fit below `y`. */
  function fit(y: number, needed: number): number {
    return y + needed > contentBottom ? addPageHeader() : y;
  }

  const REF_STYLE:   TextStyle = { font: "Courier-Bold",   size: 10, color: C.teal,     width: reqTextW };
  const TITLE_STYLE: TextStyle = { font: "Helvetica-Bold", size: 11, color: C.textDark, width: reqTextW };
  const NAME_STYLE:  TextStyle = { font: "Helvetica-Bold", size: 10, color: C.textDark, width: ctrlTextW };

  doc.y = addPageHeader();

  requirements.forEach((req, reqIndex) => {
    // Keep the reference id + title together with the first line of detail;
    // a heading orphaned at the foot of a page reads as a rendering fault.
    const headingH = measure(req.reference_id, REF_STYLE) + measure(req.title, TITLE_STYLE) + 1;
    doc.y = fit(doc.y, headingH + 26);

    const reqTop = doc.y;

    const refBottom = writeBlock(req.reference_id, margin, reqTop, REF_STYLE);
    const headingBottom = writeBlock(req.title, margin, refBottom + 1, TITLE_STYLE);

    // Status badge — right-hand column, drawn last now that the left column's
    // extent is known. doc.y is set from headingBottom afterwards, never from
    // where this write leaves it.
    writeBlock(statusLabel(req.status), margin + contentW - BADGE_W, reqTop + 1, {
      font: "Helvetica-Bold",
      size: 8,
      color: statusColor(req.status),
      width: BADGE_W,
      align: "right",
    });

    doc.y = headingBottom + 6;

    if (req.status === "unmapped" || req.controls.length === 0) {
      const note = "No controls mapped to this requirement.";
      const style: TextStyle = {
        font: "Helvetica-Oblique", size: 9, color: C.slate, width: ctrlTextW,
      };
      doc.y = writeBlock(note, margin + INDENT, fit(doc.y, measure(note, style)), style);
      doc.y += 4;
    } else {
      req.controls.forEach((ctrl, ctrlIndex) => {
        doc.y = fit(doc.y, measure(ctrl.control_name, NAME_STYLE) + 24);

        let cy = writeBlock(ctrl.control_name, margin + INDENT, doc.y, NAME_STYLE);

        // Assessment status + severity
        const aStatus = ctrl.assessment_status
          ? ctrl.assessment_status.replace(/_/g, " ")
          : "no assessment";
        const aLine = ctrl.overall_severity
          ? `${aStatus}  ·  ${ctrl.overall_severity}`
          : aStatus;

        const aColor =
          ctrl.assessment_status === "passed"  ? C.green :
          ctrl.assessment_status === "failed"  ? C.red :
          ctrl.assessment_status === null      ? C.slate :
          C.amber;

        cy = writeBlock(aLine, margin + INDENT, cy + 2, {
          font: "Helvetica", size: 9, color: aColor, width: ctrlTextW,
        });

        // Assessment summary
        if (ctrl.assessment_summary) {
          const style: TextStyle = {
            font: "Helvetica-Oblique", size: 9, color: C.slate, width: ctrlTextW, lineGap: 1,
          };
          const h = measure(ctrl.assessment_summary, style);
          cy = cy + 2 > contentBottom - h ? addPageHeader() : cy + 2;
          cy = writeBlock(ctrl.assessment_summary, margin + INDENT, cy, style);
        }

        // Evidence
        if (ctrl.evidence.length > 0) {
          const heading = `Evidence (${ctrl.evidence.length} item${ctrl.evidence.length !== 1 ? "s" : ""}):`;
          const headStyle: TextStyle = {
            font: "Helvetica", size: 9, color: C.slate, width: ctrlTextW,
          };
          cy = cy + 6 > contentBottom - 24 ? addPageHeader() : cy + 6;
          cy = writeBlock(heading, margin + INDENT, cy, headStyle);

          for (const ev of ctrl.evidence) {
            const line = `• [${ev.evidence_type}] ${ev.title}`;
            const lineStyle: TextStyle = {
              font: "Helvetica", size: 9, color: C.textDark, width: evTextW,
            };
            const metaStyle: TextStyle = {
              font: "Helvetica", size: 8, color: C.slate, width: evTextW,
            };
            // Keep an evidence item and its metadata on one page.
            cy = fit(cy + 2, measure(line, lineStyle) + 20);
            cy = writeBlock(line, margin + 20, cy, lineStyle);

            const meta: string[] = [];
            if (ev.collected_at) meta.push(`Collected: ${fmtDate(ev.collected_at)}`);
            if (ev.collected_by) meta.push(`by ${ev.collected_by}`);
            if (meta.length > 0) {
              cy = writeBlock(`  ${meta.join("  ")}`, margin + 20, cy + 1, metaStyle);
            }
            if (ev.external_ref) {
              cy = writeBlock(`  Ref: ${ev.external_ref}`, margin + 20, cy + 1, metaStyle);
            }
          }
        }

        doc.y = cy + 6;

        // Thin separator between controls — never after the last one, and
        // never as the only thing carried onto a page.
        if (ctrlIndex < req.controls.length - 1 && doc.y + 8 <= contentBottom) {
          doc.rect(margin + INDENT, doc.y, contentW - INDENT * 2, 0.5).fill("#e2e8f0");
          doc.y += 6;
        }
      });
    }

    // Divider between requirements
    if (reqIndex < requirements.length - 1) {
      if (doc.y + 14 > contentBottom) {
        doc.y = addPageHeader();
      } else {
        doc.rect(margin, doc.y + 3, contentW, 1).fill("#e2e8f0");
        doc.y += 14;
      }
    }
  });

  // Stamp "Page N of TOTAL" footers on every page with the real page count.
  stampFooters(doc, { leftText: "SecureLogic AI — Confidential", textColor: C.slate });

  doc.end();
}

router.get(
  "/frameworks/:id/audit-package.pdf",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    let pkg: AuditPackage | null;
    try {
      pkg = await withTenant(organizationId, () => assembleAuditPackage(organizationId, frameworkId));
    } catch (err) {
      logger.error({ event: "audit_package_pdf_failed", err }, "PDF assembly failed");
      res.status(500).json({ error: "audit_package_failed" });
      return;
    }

    if (!pkg) {
      res.status(404).json({ error: "framework_not_found" });
      return;
    }

    const { framework, organization } = pkg;
    const fileDate = new Date().toISOString().slice(0, 10);
    const filename = `${safeFilename(organization.name)}-${safeFilename(framework.name)}-audit-package-${fileDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    try {
      generateAuditPackagePDF(pkg, res);
    } catch (err) {
      logger.error({ event: "audit_package_pdf_render_failed", err }, "audit package PDF generation failed");
    }
  }
);

export default router;
