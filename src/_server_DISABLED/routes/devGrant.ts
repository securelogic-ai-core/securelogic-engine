import { Router, Request, Response } from "express";
import { grantAuditSprint } from "../entitlements/store";

const router = Router();

router.post("/grant-audit-sprint", (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "EMAIL_REQUIRED" });
  }

  grantAuditSprint(email, "DEV", "manual-dev");

  return res.status(200).json({
    status: "granted",
    product: "AUDIT_SPRINT",
    email
  });
});

export default router;
