import { Insight } from "../models/Insight.js";

export async function publishInsight(insight: Insight) {
  console.log("Insight published:", insight);
}