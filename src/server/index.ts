import express from "express";
import bodyParser from "body-parser";

import { RunnerEngine } from "../engines/v2/RunnerEngine";
import { normalizeQuestionnaire } from "../engine/intake/normalizeQuestionnaire";
import { mapToScoringInput } from "../engine/intake/mapToScoringInput";
import { requireApiKey } from "./middleware/apiKey";

const PORT = 4000;
const app = express();

app.use(bodyParser.json());
app.use("/api", requireApiKey);

app.post("/api/score", (req, res) => {
  try {
    const questionnaire = normalizeQuestionnaire(req.body);
    const scoringInput = mapToScoringInput(questionnaire);

    const result = RunnerEngine.run(scoringInput);

    return res.json({ ok: true, engineResult: result });
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SecureLogic AI Engine running on port ${PORT}`);
});
