import { Router } from "express";
import { randomUUID } from "crypto";
import { RunnerEngine } from "../../engine/RunnerEngine";
import type { AuditSprintInput } from "../../engine/contracts/AuditSprintInput";
import { saveAuditResult } from "../store/auditSprintStore";

const router = Router();

router.post("/intake", (req, res) => {
  const input = req.body as AuditSprintInput;

  if (!input?.email || typeof input.email !== "string") {
    return res.status(400).json({ error: "EMAIL_REQUIRED" });
  }

  const result = RunnerEngine.run(input);
  const auditId = randomUUID();

  saveAuditResult(auditId, input.email, result);

  return res.status(202).json({
    status: "accepted",
    auditId
  });
});

export default router;
