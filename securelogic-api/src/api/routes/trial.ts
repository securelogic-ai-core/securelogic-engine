import express from "express";
import { issueTrialKey } from "../../auth/trialKeyStore.js";

const router = express.Router();

router.post("/start", (_req, res) => {
  const trial = issueTrialKey();

  res.json({
    apiKey: trial.key,
    expiresAt: trial.expiresAt,
    tier: trial.tier
  });
});

export default router;
