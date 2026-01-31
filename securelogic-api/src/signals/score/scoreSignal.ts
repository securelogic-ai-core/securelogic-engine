import { DedupedSignal } from "../contract/DedupedSignal";
import { ScoredSignal } from "../contract/ScoredSignal";

export function scoreSignal(signal: DedupedSignal): ScoredSignal {
  let score = 0;
  const rationale: string[] = [];

  // Severity contribution (max 50)
  score += signal.severity * 5;
  rationale.push(`Severity ${signal.severity} contributes ${signal.severity * 5}`);

  // Confidence contribution (max 30)
  const confidenceScore = Math.round(signal.confidence * 30);
  score += confidenceScore;
  rationale.push(`Confidence ${signal.confidence} contributes ${confidenceScore}`);

  // Frequency contribution (max 20)
  const freqScore = Math.min(signal.occurrences * 5, 20);
  score += freqScore;
  rationale.push(`Occurrences ${signal.occurrences} contributes ${freqScore}`);

  let band: ScoredSignal["risk"]["band"] = "LOW";
  if (score >= 80) band = "CRITICAL";
  else if (score >= 60) band = "HIGH";
  else if (score >= 40) band = "MEDIUM";

  return {
    ...signal,
    risk: {
      score,
      band,
      rationale
    }
  };
}
