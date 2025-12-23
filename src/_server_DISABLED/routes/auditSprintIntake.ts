import { Router, Request, Response } from "express";
import { validateURO } from "../../validation/validateURO";

const router = Router();

router.post("/", (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Normalize legacy / flat intake payloads
    const normalizedInput = {
      email: body.email,

      orgProfile: body.orgProfile ?? {
        industry: body.industry,
        size: body.size,
        aiUsage: body.aiUsage ?? []
      },

      system: body.system,
      triggers: body.triggers ?? [],
      controls: body.controls ?? {},
      metadata: body.metadata ?? {}
    };

    const uro = validateURO(normalizedInput);

    return res.status(200).json({
      status: "accepted",
      uroId: uro.id
    });
  } catch (err: any) {
    console.error("INTAKE FAILED:", err);
    return res.status(400).json({
      error: "AUDIT_FAILED",
      message: err.message
    });
  }
});

export default router;
