import express from "express";
import { expireKey } from "../../auth/trialKeyStore.js";

const router = express.Router();

router.post("/revoke", (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: "apiKey required" });
  }

  const revoked = expireKey(apiKey);
  return res.json({ revoked });
});

export default router;