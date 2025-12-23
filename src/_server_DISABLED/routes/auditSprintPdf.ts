import { Router } from "express";
import { RunnerEngine } from "../../engine/RunnerEngine";
import { generateAuditSprintPdf } from "../../reports/AuditSprintPdf";
import { resolveLicense } from "../auth/resolveLicense";
import { normalizeAuditSprintResult } from "../adapters/normalizeAuditSprintResult";
import crypto from "crypto";

const router = Router();

router.post("/", (req, res) => {
  const license = resolveLicense(req);

  if (license === "FREE") {
    return res.status(402).json({
      error: "PaymentRequired",
      message: "Upgrade to PRO to export reports"
    });
  }

  try {
    const rawResult = RunnerEngine.run(req.body);
    const result = normalizeAuditSprintResult(rawResult);

    const reportId = crypto.randomUUID();
    const path = generateAuditSprintPdf(reportId, result);

    return res.status(200).json({
      reportId,
      path
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "PdfGenerationFailed",
      message: err.message ?? "Unknown error"
    });
  }
});

export default router;
