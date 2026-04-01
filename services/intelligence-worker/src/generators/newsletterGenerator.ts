import { pg } from "../../../../src/api/infra/postgres.js";
import {
  createIssue,
  getActiveIssue
} from "../storage/postgresIssueStore.js";

type Trend = {
  id: string;
  organization_id: string;
  name: string;
  category: string;
  description: string;
  score: string | number | null;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeTrend(trend: Trend) {
  return {
    trendId: trend.id,
    title: trend.name,
    category: trend.category,
    score: toNumber(trend.score),
    summary: trend.description
  };
}

function buildSummary(trends: Trend[]): string {
  if (trends.length === 0) {
    return "No significant trend items were available for this issue.";
  }

  const highCount = trends.filter((trend) => toNumber(trend.score) >= 0.75).length;

  if (highCount > 0) {
    return `This issue highlights ${highCount} high-priority cyber risk development(s) requiring attention, alongside broader intelligence themes relevant to security and risk leadership.`;
  }

  return `Top ${trends.length} cyber risk items generated for the current intelligence window.`;
}

function buildMarkdown(trends: Trend[]): string {
  if (trends.length === 0) {
    return "# SecureLogic Cyber Risk Intelligence Brief\n\nNo trend items were available.";
  }

  const body = trends
    .map((trend, index) => {
      const score = toNumber(trend.score).toFixed(2);

      return [
        `## ${index + 1}. ${trend.name}`,
        ``,
        `Category: ${trend.category}`,
        `Score: ${score}`,
        ``,
        `${trend.description}`
      ].join("\n");
    })
    .join("\n\n");

  return `# SecureLogic Cyber Risk Intelligence Brief\n\n${body}`;
}

function buildHtml(trends: Trend[]): string {
  if (trends.length === 0) {
    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SecureLogic Cyber Risk Intelligence Brief</title>
</head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:900px;margin:0 auto;padding:24px;">
  <h1>SecureLogic Cyber Risk Intelligence Brief</h1>
  <p>No trend items were available.</p>
</body>
</html>
    `.trim();
  }

  const body = trends
    .map((trend, index) => {
      const score = toNumber(trend.score).toFixed(2);

      return `
        <section style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin-bottom:12px;">
          <h2 style="margin-top:0;">${index + 1}. ${escapeHtml(trend.name)}</h2>
          <p><strong>Category:</strong> ${escapeHtml(trend.category)}<br/><strong>Score:</strong> ${score}</p>
          <p>${escapeHtml(trend.description)}</p>
        </section>
      `.trim();
    })
    .join("");

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SecureLogic Cyber Risk Intelligence Brief</title>
</head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:900px;margin:0 auto;padding:24px;">
  <h1>SecureLogic Cyber Risk Intelligence Brief</h1>
  ${body}
</body>
</html>
  `.trim();
}

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const organizationId = result.rows[0]?.id as string | undefined;

  if (!organizationId) {
    throw new Error("No organization found for newsletter generation");
  }

  return organizationId;
}

export async function generateNewsletter(): Promise<number> {
  const organizationId = await getDefaultOrganizationId();

  const activeIssue = await getActiveIssue(organizationId, ["draft", "queued"]);

  if (activeIssue) {
    console.log(
      "Newsletter generation skipped: active issue already exists",
      activeIssue.id,
      activeIssue.status
    );
    return 0;
  }

  const result = await pg.query(
    `
    SELECT id, organization_id, name, category, description, score
    FROM trends
    WHERE organization_id = $1
    ORDER BY score DESC NULLS LAST, created_at DESC
    LIMIT 10
    `,
    [organizationId]
  );

  const trends = result.rows as Trend[];

  const sections = {
    topItems: trends.map(normalizeTrend)
  };

  await createIssue({
    organizationId,
    title: "SecureLogic Cyber Risk Intelligence Brief",
    status: "draft",
    audienceTier: "standard",
    summary: buildSummary(trends),
    sectionsJson: sections,
    contentMd: buildMarkdown(trends),
    contentHtml: buildHtml(trends)
  });

  console.log("Newsletter issue created for organization:", organizationId);
  return 1;
}
