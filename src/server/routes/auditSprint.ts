import { Router } from "express";
import { RunnerEngine } from "../../engine/RunnerEngine";

const router = Router();

router.post("/", (req, res) => {
  const result = RunnerEngine.run(req.body);
  res.json(result);
});

export default router;
