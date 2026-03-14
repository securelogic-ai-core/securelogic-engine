import fs from "fs/promises";

const FILE = "./data/insights.json";

export async function saveInsight(insight: any) {

  let insights = [];

  try {
    const raw = await fs.readFile(FILE, "utf8");
    insights = JSON.parse(raw);
  } catch {}

  insights.push(insight);

  await fs.writeFile(FILE, JSON.stringify(insights, null, 2));
}