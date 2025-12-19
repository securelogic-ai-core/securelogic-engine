import { Router } from "express";
import { RunnerEngine } from "../../engine/RunnerEngine";
import { validateAuditSprintInput } from "../validators/auditSprintValidator";
import { resolveLicense } from "../auth/resolveLicense";
import { normalizeAuditSprintResult } from "../adapters/normalizeAuditSprintResult";
import { hasFeature } from "../auth/featureGate";

const router = Router();

router.post("/", (req, res) => {
  const validationError = validateAuditSprintInput(req.body);
  if (validationError) {
    return res.status(400).json({
      error: "InvalidRequest",
      message: validationError
    });
  }

  const license = resolveLicense(req);

  // ---- RUN ENGINE (STATIC) ----
  const engineResult = RunnerEngine.run(req.body);

  // ---- NORMALIZE ----
  const normalized = normalizeAuditSprintResult(engineResult);

  // ---- FEATURE GATING ----
  if (!hasFeature(license, "RISK_SCORING")) {
    return res.json({
      version: normalized.version,
      assessment: normalized.assessment,
      executiveSummary: {
        narrative: normalized.executiveSummary.narrative,
        overallRisk: normalized.executiveSummary.overallRisk
      },
      disclaimers: normalized.disclaimers
    });
  }

  // PRO / ENTERPRISE
  res.json(normalized);
});

export default router;