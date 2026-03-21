import { saveSignal, getSignals } from "./postgresSignalStore.js";
import { saveInsight, getInsights } from "./postgresInsightStore.js";
import { createIssue, getLatestSentIssue, markIssueSent } from "./postgresIssueStore.js";
import { startRun, completeRun } from "./postgresRunStore.js";

async function main() {
  const runId = await startRun();

  const signalId = await saveSignal({
    category: "security",
    title: "Test signal",
    source: "manual",
    sourceUrl: "https://example.com/test-signal",
    summary: "Smoke test signal",
    tags: ["test"],
    processed: true
  });

  console.log("signalId:", signalId);

  if (!signalId) {
    throw new Error("Signal was not inserted");
  }

  const insightId = await saveInsight({
    signalId,
    title: "Test insight",
    analysis: "This is a smoke test insight",
    riskLevel: "medium",
    audience: "internal"
  });

  console.log("insightId:", insightId);

  const issueId = await createIssue({
    title: "Smoke Test Issue",
    summary: "Platform storage smoke test",
    contentHtml: "<p>Smoke test issue</p>",
    contentMd: "Smoke test issue"
  });

  console.log("issueId:", issueId);

  await markIssueSent(issueId);

  const latestIssue = await getLatestSentIssue();
  console.log("latestIssue:", latestIssue?.id ?? null);

  const signals = await getSignals(5);
  const insights = await getInsights(5);

  console.log("signals:", signals.length);
  console.log("insights:", insights.length);

  await completeRun(runId, 1, 1, 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
