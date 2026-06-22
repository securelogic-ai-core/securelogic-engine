import { Router, type Request, type Response } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { analyzeAssessmentDocument } from "../lib/claudeAssessmentAnalyzer.js";
import { logger } from "../infra/logger.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ["application/pdf", "text/plain", "text/csv"];
    const allowedExtensions = /\.(pdf|txt|csv)$/i;
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    const extOk = allowedExtensions.test(file.originalname);
    if (mimeOk && extOk) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_file_type"));
    }
  }
});

export async function analyzeAssessmentDocumentHandler(req: Request, res: Response): Promise<void> {
  try {
    const organizationId: string | null =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "no_file_uploaded" });
      return;
    }

    const vendorName = ((req.body as Record<string, string>)["vendor_name"] ?? "").trim();
    if (!vendorName) {
      res.status(400).json({ error: "vendor_name_required" });
      return;
    }

    const documentHint = ((req.body as Record<string, string>)["document_hint"] ?? "").trim() || undefined;

    let documentText: string;
    if (req.file.mimetype === "application/pdf") {
      // pdf-parse v2 throws on `instanceof Buffer`; pass a plain Uint8Array
      // view over the same memory. multer's memoryStorage hands us a Buffer.
      const buf = req.file.buffer;
      const pdfData: Uint8Array = Buffer.isBuffer(buf)
        ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : buf;
      const parser = new PDFParse(pdfData);
      const result = await parser.getText();
      documentText = result.text;
    } else {
      documentText = req.file.buffer.toString("utf-8");
    }

    if (!documentText.trim()) {
      res.status(422).json({ error: "document_text_empty" });
      return;
    }

    const result = await analyzeAssessmentDocument(documentText, vendorName, documentHint, organizationId);

    if (!result) {
      res.status(503).json({ error: "analysis_unavailable" });
      return;
    }

    res.status(200).json({ analysis: result });
  } catch (err) {
    logger.error({ event: "vendor_doc_analysis_failed", err }, "POST /vendor-assessments/analyze-document failed");
    res.status(500).json({ error: "internal_error" });
  }
}

router.post(
  "/vendor-assessments/analyze-document",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  upload.single("document"),
  analyzeAssessmentDocumentHandler
);

export default router;
