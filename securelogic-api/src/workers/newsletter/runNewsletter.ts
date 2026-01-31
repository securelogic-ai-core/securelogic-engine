/**
 * Newsletter Worker
 * Generates Executive Risk Intelligence issues
 */

import { fetchCisaKevSignals } from "./sources/index.js";
import { fetchNvdSignals } from "./sources/nvd.js";
import type { NewsletterSignal } from "./types/NewsletterSignal.ts";

export async function runNewsletter(): Promise<void> {
  console.log("Starting newsletter run");

  // Step 1: Collect raw signals
  const rawSignals: NewsletterSignal[] = [];

  rawSignals.push(...(await fetchCisaKevSignals()));
  rawSignals.push(...(await fetchNvdSignals()));

  console.log(`Collected ${rawSignals.length} raw signals`);

  // Step 2: Deduplicate by CVE (prefer CISA KEV)
  const dedupedMap = new Map<string, NewsletterSignal>();

  for (const signal of rawSignals) {
    const cveMatch = signal.title.match(/CVE-\d{4}-\d+/i);
    const cveId = cveMatch?.[0];

    if (!cveId) continue;

    const existing = dedupedMap.get(cveId);

    if (!existing) {
      dedupedMap.set(cveId, signal);
      continue;
    }

    // Prefer CISA KEV over everything else
    if (existing.source !== "CISA_KEV" && signal.source === "CISA_KEV") {
      dedupedMap.set(cveId, signal);
    }
  }

  const dedupedSignals = Array.from(dedupedMap.values());

  console.log(`Deduplicated to ${dedupedSignals.length} unique CVEs`);

  // Step 3: Rank for executive relevance
  const ranked = dedupedSignals
    .map((signal) => ({
      ...signal,
      relevanceScore: scoreExecutiveRelevance(signal),
    }))
    .filter((s) => s.relevanceScore >= 60)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  console.log(`Selected ${ranked.length} executive-grade signals`);

  // Step 4: Output preview
  for (const s of ranked.slice(0, 20)) {
    console.log(`• ${s.title} (${s.relevanceScore})`);
  }

  console.log("Newsletter run complete");
}

function scoreExecutiveRelevance(signal: NewsletterSignal): number {
  let score = 0;

  if (signal.severity === "High" || signal.severity === "Critical") {
    score += 40;
  }

  if (signal.tags.includes("exploited")) {
    score += 30;
  }

  if (signal.source === "CISA_KEV") {
    score += 20;
  }

  return Math.min(score, 100);
}

/**
 * CLI entrypoint
 */
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  runNewsletter().catch((err) => {
    console.error("Newsletter run failed");
    console.error(err);
    process.exit(1);
  });
}