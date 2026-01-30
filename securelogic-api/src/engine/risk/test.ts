import { RiskScoringEngine } from "./RiskScoringEngine";

const result = RiskScoringEngine.score([
  { id: "1", severity: "High", confidence: 90, domain: "Identity" },
  { id: "2", severity: "Medium", confidence: 80, domain: "Network" },
  { id: "3", severity: "Critical", confidence: 100, domain: "Access" },
]);

console.log(JSON.stringify(result, null, 2));
