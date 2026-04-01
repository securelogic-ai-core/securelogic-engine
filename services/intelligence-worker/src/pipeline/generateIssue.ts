import { createIssue } from "../storage/postgresIssueStore.js";

export async function generateIssue(insights: any[]) {
  const title = "SecureLogic Weekly Intelligence #" + Date.now();

  const contentHtml = insights
    .map(
      (i) => `
  <h3>${i.title ?? "Untitled Insight"}</h3>
  <p>${i.summary ?? i.analysis ?? ""}</p>
  <hr/>
  `
    )
    .join("");

  const contentMd = insights
    .map(
      (i) => `
### ${i.title ?? "Untitled Insight"}

${i.summary ?? i.analysis ?? ""}
`
    )
    .join("\n");

  const issueId = await createIssue({
    title,
    contentHtml,
    contentMd,
    status: "draft",
    audienceTier: "free",
    summary: "Generated newsletter issue"
  });

  return issueId;
}