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
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

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

type AuditPackage = {
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
  const readiness_score = total === 0 ? 0 : Math.round((satisfiedCount / total) * 100);

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
      const pkg = await assembleAuditPackage(organizationId, frameworkId);
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

router.get(
  "/frameworks/:id/audit-package.pdf",
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

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    let pkg: AuditPackage | null;
    try {
      pkg = await assembleAuditPackage(organizationId, frameworkId);
    } catch (err) {
      logger.error({ event: "audit_package_pdf_failed", err }, "PDF assembly failed");
      res.status(500).json({ error: "audit_package_failed" });
      return;
    }

    if (!pkg) {
      res.status(404).json({ error: "framework_not_found" });
      return;
    }

    const { framework, organization, readiness_summary: rs, requirements } = pkg;
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const filename = `${safeFilename(organization.name)}-${safeFilename(framework.name)}-audit-package-${fileDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // ── Page 1: Cover ──────────────────────────────────────────────────────────
    doc.rect(0, 0, pageW, pageH).fill(C.navy);

    doc
      .fillColor(C.teal)
      .font("Helvetica")
      .fontSize(11)
      .text("SecureLogic AI", margin, 80, { width: contentW, align: "left" });

    doc
      .fillColor(C.textLight)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(framework.name, margin, 130, { width: contentW });

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
      .text(`Generated ${dateStr}`, margin, doc.y + 6, { width: contentW });

    // Bottom teal bar
    doc.rect(0, pageH - 36, pageW, 1).fill(C.teal);
    doc
      .fillColor(C.slate)
      .font("Helvetica")
      .fontSize(9)
      .text("CONFIDENTIAL", margin, pageH - 28, { width: contentW, align: "center" });

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
    const boxes = [
      { label: "Readiness Score", value: `${rs.readiness_score}%`, color: scoreColor(rs.readiness_score) },
      { label: "Total Requirements", value: String(rs.total_requirements), color: C.textDark },
      { label: "Satisfied", value: String(rs.satisfied), color: C.green },
      { label: "Unmapped", value: String(rs.unmapped), color: C.slate },
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
      `The organization has satisfied ${rs.satisfied} of ${rs.total_requirements} requirements ` +
      `(${rs.readiness_score}% readiness).`;

    doc
      .fillColor(C.textDark)
      .font("Helvetica")
      .fontSize(11)
      .text(summaryPara, margin, doc.y, { width: contentW, lineGap: 3 });

    // ── Pages 3+: Requirements ─────────────────────────────────────────────────
    let pageNum = 2;

    function addPageHeader() {
      doc.addPage();
      pageNum++;

      doc
        .fillColor(C.slate)
        .font("Helvetica")
        .fontSize(8)
        .text(`${organization.name} — ${framework.name}`, margin, 20, { width: contentW / 2 })
        .text("CONFIDENTIAL", margin + contentW / 2, 20, { width: contentW / 2, align: "right" });

      doc.rect(margin, 32, contentW, 0.5).fill(C.slate);

      return 44; // y after header
    }

    function addPageNumber() {
      doc
        .fillColor(C.slate)
        .font("Helvetica")
        .fontSize(8)
        .text(String(pageNum), margin, pageH - 24, { width: contentW, align: "right" });
    }

    let startY = addPageHeader();
    doc.y = startY;

    for (const req of requirements) {
      // Check if we need a new page (need at least 80px for the requirement header)
      if (doc.y > pageH - 120) {
        addPageNumber();
        startY = addPageHeader();
        doc.y = startY;
      }

      const reqTop = doc.y;

      // Reference ID + title row
      doc
        .fillColor(C.teal)
        .font("Courier-Bold")
        .fontSize(10)
        .text(req.reference_id, margin, doc.y, { continued: false });

      doc
        .fillColor(C.textDark)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(req.title, margin, doc.y, { width: contentW - 90 });

      // Status badge — right-aligned at reqTop
      doc
        .fillColor(statusColor(req.status))
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(statusLabel(req.status), margin, reqTop, { width: contentW, align: "right" });

      doc.moveDown(0.4);

      if (req.status === "unmapped" || req.controls.length === 0) {
        doc
          .fillColor(C.slate)
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text("No controls mapped to this requirement.", margin + 12, doc.y);
        doc.moveDown(0.6);
      } else {
        for (const ctrl of req.controls) {
          if (doc.y > pageH - 100) {
            addPageNumber();
            startY = addPageHeader();
            doc.y = startY;
          }

          // Control name
          doc
            .fillColor(C.textDark)
            .font("Helvetica-Bold")
            .fontSize(10)
            .text(ctrl.control_name, margin + 12, doc.y);

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

          doc
            .fillColor(aColor)
            .font("Helvetica")
            .fontSize(9)
            .text(aLine, margin + 12, doc.y + 2);

          // Assessment summary
          if (ctrl.assessment_summary) {
            doc
              .fillColor(C.slate)
              .font("Helvetica-Oblique")
              .fontSize(9)
              .text(ctrl.assessment_summary, margin + 12, doc.y + 2, {
                width: contentW - 24,
                lineGap: 1,
              });
          }

          // Evidence
          if (ctrl.evidence.length > 0) {
            doc.moveDown(0.3);
            doc
              .fillColor(C.slate)
              .font("Helvetica")
              .fontSize(9)
              .text(`Evidence (${ctrl.evidence.length} item${ctrl.evidence.length !== 1 ? "s" : ""}):`, margin + 12, doc.y);

            for (const ev of ctrl.evidence) {
              if (doc.y > pageH - 80) {
                addPageNumber();
                startY = addPageHeader();
                doc.y = startY;
              }
              doc
                .fillColor(C.textDark)
                .font("Helvetica")
                .fontSize(9)
                .text(`• [${ev.evidence_type}] ${ev.title}`, margin + 20, doc.y + 1, {
                  width: contentW - 32,
                });

              const meta: string[] = [];
              if (ev.collected_at) meta.push(`Collected: ${fmtDate(ev.collected_at)}`);
              if (ev.collected_by) meta.push(`by ${ev.collected_by}`);
              if (meta.length > 0) {
                doc
                  .fillColor(C.slate)
                  .font("Helvetica")
                  .fontSize(8)
                  .text(`  ${meta.join("  ")}`, margin + 20, doc.y + 1, { width: contentW - 32 });
              }
              if (ev.external_ref) {
                doc
                  .fillColor(C.slate)
                  .font("Helvetica")
                  .fontSize(8)
                  .text(`  Ref: ${ev.external_ref}`, margin + 20, doc.y + 1, { width: contentW - 32 });
              }
            }
          }

          doc.moveDown(0.5);
          // Thin separator between controls
          doc.rect(margin + 12, doc.y, contentW - 24, 0.5).fill("#e2e8f0");
          doc.moveDown(0.5);
        }
      }

      // Divider between requirements
      doc.rect(margin, doc.y + 2, contentW, 1).fill("#e2e8f0");
      doc.moveDown(1);
    }

    addPageNumber();

    // Stamp page numbers on all pages
    const pages = (doc as any).bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
    }

    doc.end();
  }
);

export default router;
