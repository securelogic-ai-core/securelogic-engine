import fs from "fs";
import path from "path";
import crypto from "crypto";

const secret = process.env.SECURELOGIC_SIGNING_SECRET;
if (!secret) throw new Error("SECURELOGIC_SIGNING_SECRET missing");

const ISSUES_DIR = path.resolve("data/issues");
fs.mkdirSync(ISSUES_DIR, { recursive: true });

const issue = {
  issueNumber: 1,
  title: "Issue #1 — Credential-Based Systemic Failure",
  executiveSummary: "A systemic governance failure disrupted mission-critical operations.",
  domains: ["Operational Resilience", "Third-Party Risk", "Identity"],
  riskTable: [
    { domain: "Operational Resilience", rating: "CRITICAL" },
    { domain: "Third-Party Risk", rating: "CRITICAL" },
    { domain: "Identity", rating: "CRITICAL" }
  ],
  confidence: "HIGH",
  publishedAt: new Date().toISOString()
};

const payload = JSON.stringify(issue);

const signature = crypto
  .createHmac("sha256", secret)
  .update(payload)
  .digest("base64");

const artifact = {
  issue,
  signature,
  signedAt: new Date().toISOString()
};

const outPath = path.join(ISSUES_DIR, "issue-1.json");
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

console.log("✅ Issue generated:", outPath);
