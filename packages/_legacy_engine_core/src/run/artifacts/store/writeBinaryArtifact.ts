import fs from "fs";
import path from "path";
import crypto from "crypto";

import { synthesizeDecision } from "../../../decision/DecisionSynthesisEngine.js";
import { writeDecision } from "../../../decision/store/writeDecision.js";
import { writeRiskContext } from "../../../context/store/writeRiskContext.js";
import { writeFindings } from "../../../findings/store/writeFindings.js";

import type { RiskContext } from "../../../context/RiskContext.js";
import type { Finding } from "../../../findings/Finding.js";

const ARTIFACT_DIR = "artifacts";
const RUN_DIR = "runs";

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

export function writeBinaryArtifact(runId: string, type: string, data: Buffer) {
  const artifactId = crypto.randomUUID();
  const filename = `${runId}.${artifactId}.pdf`;
  const filePath = path.join(ARTIFACT_DIR, filename);

  fs.writeFileSync(filePath, data);

  const checksum = crypto.createHash("sha256").update(data).digest("hex");

  const record = {
    runId,
    artifactId,
    type,
    filename,
    path: path.resolve(filePath),
    size: data.length,
    checksum,
    createdAt: new Date().toISOString()
  };

  const manifestFile = path.join(RUN_DIR, `${runId}.artifacts.json`);
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf-8"))
    : [];

  manifest.push(record);

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  // ---- Create canonical context ----
  const context: RiskContext = {
    contextId: runId,
    subjectType: "VENDOR",
    subjectName: "Test Vendor",
    businessCriticality: "HIGH",
    dataSensitivity: "CONFIDENTIAL",
    exposure: "EXTERNAL_DEPENDENCY",
    intendedUse: "Production SaaS",
    regulatoryDrivers: ["SOC2", "ISO27001"],
    createdAt: new Date().toISOString()
  };

  writeRiskContext(context);

  // ---- Create canonical findings ----
  const findings: Finding[] = [
    {
      id: "F-001",
      controlId: "AC-2",
      title: "No MFA for admin accounts",
      severity: "HIGH",
      evidence: "Vendor confirmed MFA not enforced"
    }
  ];

  writeFindings(runId, findings);

  // ---- Load policy bundle ----
  const policyFile = path.join("policy-bundles", "default.policy.json");
  if (!fs.existsSync(policyFile)) {
    throw new Error("DEFAULT_POLICY_BUNDLE_NOT_FOUND");
  }

  const policyBundle = JSON.parse(fs.readFileSync(policyFile, "utf8"));

  // ---- Synthesize decision ----
  const decision = synthesizeDecision(context, findings, policyBundle);

  writeDecision(decision);

  return record;
}