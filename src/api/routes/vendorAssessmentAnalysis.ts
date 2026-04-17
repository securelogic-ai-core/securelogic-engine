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
    const allowed = ["application/pdf", "text/plain", "text/csv"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_file_type"));
    }
  }
});

router.post(
  "/vendor-assessments/analyze-document",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  upload.single("document"),
  async (req: Request, res: Response) => {
    try {
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
        const parser = new PDFParse(req.file.buffer);
        const result = await parser.getText();
        documentText = result.text;
      } else {
        documentText = req.file.buffer.toString("utf-8");
      }

      if (!documentText.trim()) {
        res.status(422).json({ error: "document_text_empty" });
        return;
      }

      const result = await analyzeAssessmentDocument(documentText, vendorName, documentHint);

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
);

export default router;
