#!/usr/bin/env node

/**
 * SecureLogic Issue Publisher
 * VALIDATE → SIGN → WRITE
 *
 * This tool is the ONLY way issues are allowed to be published.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isIssue } from "../api/contracts/issue.schema";
import type { Issue } from "../api/contracts/issue.schema";

/* =========================================================
   CONSTANTS
   ========================================================= */

const ISSUES_DIR = path.resolve("data/issues");
const PRIVATE_KEY_PATH = path.resolve("keys/issue.private.pem");

/* =========================================================
   LOAD PRIVATE KEY
   ========================================================= */

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error("❌ Issue signing private key not found");
  process.exit(1);
}

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8");

/* =========================================================
   LOAD INPUT FILE
   ========================================================= */

const inputFile = process.argv[2];

if (!inputFile) {
  console.error("❌ Usage: publishIssue <issue.json>");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Input file not found: ${inputFile}`);
  process.exit(1);
}

let raw: unknown;

try {
  raw = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
} catch {
  console.error("❌ Invalid JSON input");
  process.exit(1);
}

/* =========================================================
   SCHEMA VALIDATION (FAIL CLOSED)
   ========================================================= */

if (!isIssue(raw)) {
  console.error("❌ Issue schema validation failed");
  process.exit(1);
}

const issue = raw as Issue;

/* =========================================================
   SIGN ISSUE
   ========================================================= */

const signer = crypto.createSign("RSA-SHA256");
signer.update(JSON.stringify(issue));
signer.end();

const signature = signer.sign(privateKey, "base64");

/* =========================================================
   BUILD ARTIFACT
   ========================================================= */

const artifact = {
  issue,
  signature,
  signedAt: new Date().toISOString()
};

/* =========================================================
   WRITE TO DISK
   ========================================================= */

fs.mkdirSync(ISSUES_DIR, { recursive: true });

const outPath = path.join(
  ISSUES_DIR,
  `issue-${issue.issueNumber}.json`
);

fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf-8");

/* =========================================================
   SUCCESS
   ========================================================= */

console.log(`✅ Issue ${issue.issueNumber} published`);
console.log(`📄 ${outPath}`);