import { Request, Response, NextFunction } from "express";
import { hasAuditSprint } from "../entitlements/store";

export function requireEntitlement(product: "AUDIT_SPRINT") {
  return (req: Request, res: Response, next: NextFunction) => {
    const email = req.body?.email;

    if (!email) {
      return res.status(400).json({ error: "EMAIL_REQUIRED" });
    }

    const entitled =
      product === "AUDIT_SPRINT" && hasAuditSprint(email);

    if (!entitled) {
      return res.status(403).json({
        error: "ENTITLEMENT_REQUIRED",
        message: "Audit Sprint not purchased"
      });
    }

    next();
  };
}
