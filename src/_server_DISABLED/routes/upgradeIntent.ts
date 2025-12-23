import { Router } from "express";

const router = Router();

/**
 * Captures upgrade intent for monetization follow-up
 */
router.post("/", (req, res) => {
  const { email, company, desiredTier } = req.body;

  if (!email || !desiredTier) {
    return res.status(400).json({
      error: "InvalidRequest",
      message: "email and desiredTier are required"
    });
  }

  // TEMP: log intent (replace with DB/CRM later)
  console.log("UPGRADE INTENT:", {
    email,
    company,
    desiredTier,
    timestamp: new Date().toISOString()
  });

  return res.status(202).json({
    status: "captured",
    message: "Upgrade request received. Sales will contact you."
  });
});

export default router;
