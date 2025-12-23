import { Router } from "express";
import { RunnerEngine } from "../../engine/RunnerEngine";
import type { AuditSprintInput } from "../../engine/contracts/AuditSprintInput";

const router = Router();

router.post("/", (req, res) => {
  const input = req.body as AuditSprintInput;
  res.json(RunnerEngine.run(input));
});

export default router;
