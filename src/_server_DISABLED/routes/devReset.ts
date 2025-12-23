import { Router, Request, Response } from "express";
import { resetFreeTier } from "../middleware/freeTierLimit";

const router = Router();

router.post("/reset-free-tier", (_req: Request, res: Response) => {
  resetFreeTier();
  res.json({ status: "reset" });
});

export default router;