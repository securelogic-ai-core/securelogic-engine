import { execSync } from "child_process";

function run(cmd: string) {
  console.log(`\n▶️ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function pipeline() {
  console.log("🚀 Starting Daily Signal Pipeline");

  run("npx tsx src/workers/signalIngest.ts");
  run("npx tsx src/workers/enrichment/signalEnricher.ts");
  run("npx tsx src/workers/enrichment/executiveSummaryEnricher.ts");
  run("npx tsx src/workers/classification/signalClassifier.ts");

  console.log("✅ Daily Signal Pipeline complete");
}

pipeline().catch((err) => {
  console.error("❌ Pipeline failed", err);
  process.exit(1);
});