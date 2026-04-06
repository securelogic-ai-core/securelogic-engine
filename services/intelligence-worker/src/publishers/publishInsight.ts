import { Insight } from "../models/Insight.js";
import { logger } from "../../../../src/api/infra/logger.js";

export async function publishInsight(insight: Insight) {
  logger.info({ event: "insight_published", title: (insight as any).title }, "Insight published");
}