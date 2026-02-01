import fs from "fs";
import path from "path";

import { runSignalIntake } from "../signals/runSignalIntake.js";
import { detectRiskPatterns } from "../patterns/detectRiskPatterns.js";
import { generateIssueBrief } from "../issues/generateIssueBrief.js";

let ISSUE_COUNTER = 1;

export async function runBiWeeklyIssue() {
  const signals = await runSignalIntake();
  const patterns = detectRiskPatterns(signals);

  if (patterns.length === 0) {
    console.log("No risk patterns detected. No issue published.");
    return;
  }

  const issue = await generateIssueBrief(ISSUE_COUNTER++, patterns[0]);

  const outputDir = path.resolve("data/issues");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(
    outputDir,
    `issue-${issue.issueNumber}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(issue, null, 2), "utf-8");

  console.log("PUBLISHED ISSUE:", issue);
  console.log(`Saved to ${outputPath}`);
}