import { Router } from "express";
import { getAuditResult } from "../store/auditSprintStore";

const router = Router();

router.get("/:id", (req, res) => {
  const email = req.query.email;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "EMAIL_REQUIRED" });
  }

  const result = getAuditResult(req.params.id, email);

  if (!result) {
    return res.status(404).json({ error: "NotFound" });
  }

  return res.json(result);
});

export default router;
