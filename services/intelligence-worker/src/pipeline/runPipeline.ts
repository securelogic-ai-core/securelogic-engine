import { loadInsights } from "./loadInsights";
import { generateIssue } from "./generateIssue";
import { publishIssue } from "./publishIssue";

export async function runPipeline(){

  const insights = loadInsights();

  if(!insights.length){
    console.log("No insights available");
    return;
  }

  const issueId = generateIssue(insights);

  publishIssue(issueId);

}
