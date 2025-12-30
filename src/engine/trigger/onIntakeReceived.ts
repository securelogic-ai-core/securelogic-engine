import fs from "fs";

export function triggerEngine(runId: string) {
  const envelope = JSON.parse(
    fs.readFileSync(`intakes/${runId}.json`, "utf-8")
  );

  // placeholder
  console.log("ENGINE START", envelope.runContext.runId);
}
