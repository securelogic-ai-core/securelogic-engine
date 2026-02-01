import express from "express";
import { requireTrialKey } from "../../auth/requireTrialKey.js";
import { rateLimitPreview } from "../middleware/rateLimitPreview.js";
import { runSignalPipeline } from "../../signals/runSignalPipeline.js";
import { mapToPublicSignal } from "../signals/mapToPublicSignal.js";

const router = express.Router();

router.get(
  "/preview",
  requireTrialKey,
  
  async (req, res) => {
    const tier = (req as any).accessTier;
    const signals = await runSignalPipeline();
    const mapped = signals.map(s => mapToPublicSignal(s, tier));
    res.json(mapped);
  }
);

export default router;
