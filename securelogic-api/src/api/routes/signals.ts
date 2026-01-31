import express from "express";
import { getSignals } from "../signals/getSignals.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const tier =
    req.query.tier === "PAID" ? "PAID" : "FREE";

  const signals = await getSignals(tier);
  res.json(signals);
});

export default router;
