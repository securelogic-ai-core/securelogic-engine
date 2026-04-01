import { checkHealth } from "./health.js";
import { buildNewsletterIssue } from "./newsletter/newsletterBuilder.js";

async function main() {
  console.log("Worker starting...");

  const healthy = await checkHealth();
  if (!healthy) {
    console.error("System unhealthy — exiting");
    process.exit(1);
  }

  const issue = await buildNewsletterIssue();

  console.log("Newsletter generated:", issue.id);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
