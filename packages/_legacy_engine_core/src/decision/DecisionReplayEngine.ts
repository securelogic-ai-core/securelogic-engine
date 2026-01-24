import fs from "fs";
import path from "path";
import type { RiskContext } from "../context/RiskContext.js";
import type { Finding } from "../findings/Finding.js";
import { synthesizeDecision } from "./DecisionSynthesisEngine.js";

export function replayDecision(
  policyVersionId: string,
  context: RiskContext,
  findings: Finding[]
) {
  const policyFile = path.join("policy-versions", `${policyVersionId}.policy.json`);
  if (!fs.existsSync(policyFile)) {
    throw new Error("POLICY_VERSION_NOT_FOUND");
  }

  const raw = fs.readFileSync(policyFile, "utf-8");
  const bundle = JSON.parse(raw);

  return synthesizeDecision(context, findings, bundle);
}