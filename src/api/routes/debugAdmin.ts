import { Router } from "express";

const router = Router();

router.get("/debug/admin", (req, res) => {
  const receivedKey = req.header("X-Admin-Key") || null;
  const expectedKey = process.env.SECURELOGIC_ADMIN_KEY || null;

  res.status(200).json({
    receivedKey,
    expectedKey,
    match: receivedKey === expectedKey,
    receivedLength: receivedKey ? receivedKey.length : 0,
    expectedLength: expectedKey ? expectedKey.length : 0
  });
});

export default router;
