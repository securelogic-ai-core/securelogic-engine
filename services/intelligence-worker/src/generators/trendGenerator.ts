import { cleanText } from "../utils/contentSanitizer.js";
import { normalizeCategory } from "../utils/categoryMapper.js";

export function generateTrends(signals: any[]) {
  const trends = [];

  for (const signal of signals) {
    const title = cleanText(signal.title || "");
    const summary = cleanText(signal.summary || signal.rawContent || "");

    const category = normalizeCategory(signal.category || "");

    trends.push({
      title,
      summary: summary.slice(0, 300),
      category,
      score: signal.score || signal.impactScore || 0.5
    });
  }

  // Sort highest priority first
  trends.sort((a, b) => b.score - a.score);

  return trends.slice(0, 10);
}
