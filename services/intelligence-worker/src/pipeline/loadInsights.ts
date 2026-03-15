import fs from "fs";

export function loadInsights(){

  const raw = fs.readFileSync(
    "services/intelligence-worker/data/insights.json",
    "utf8"
  );

  return JSON.parse(raw);

}
