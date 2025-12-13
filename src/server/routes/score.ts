import { Router } from "express";
import { handleRequest } from "../handlers/handleRequest";
import { ScoringInput } from "../../engine/contracts/ScoringInput";

const router = Router();

router.post("/score", (req, res) => {
  try {
    const input = req.body as ScoringInput;
    const result = handleRequest(input);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Unknown error" });
  }
});

export default router;
