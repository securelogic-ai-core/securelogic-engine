import { Router, Request, Response } from "express";
import { getSignals } from "../signals/getSignals.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const tier =
    req.query.tier === "PAID" ? "PAID" : "FREE";

  const signals = await getSignals(tier);
  res.json(signals);
});

export default router;