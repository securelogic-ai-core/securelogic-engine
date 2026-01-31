import express from "express";
import { runSignalPipeline } from "../../signals/runSignalPipeline";
import { mapToPublicSignal } from "../signals/mapToPublicSignal";
import { AccessTier } from "../../signals/filter/FilterPolicy";

const router = express.Router();

router.get("/", async (req, res) => {
  const tier = (req.query.tier as AccessTier) || "FREE";

  const signals = await runSignalPipeline();

  const output = signals.map(s =>
    mapToPublicSignal(s, tier)
  );

  res.json(output);
});

export default router;
