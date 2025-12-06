import { Router } from "express";
import { ScoringEngineV3 } from "../../engines/v3/ScoringEngine";

const router = Router();

// Create engine instance once
const engine = new ScoringEngineV3();

router.post("/", (req, res) => {
  try {
    const { controls = [], intake = {} } = req.body;
    const result = engine.score(controls, intake);
    return res.json({ ok: true, result });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err.message ?? "Unknown V3 scoring error"
    });
  }
});

export default router;
