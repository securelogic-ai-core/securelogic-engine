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

function normalizeRiskLevel(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 0.9) return "critical";
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildWhyItMatters(trend: Trend, score: number): string {
  const text = `${trend.name} ${trend.description}`.toLowerCase();
  const riskLevel = normalizeRiskLevel(score);

  if (text.includes("zero-day") || text.includes("actively exploited")) {
    return "This signals active exploitation pressure and raises the probability of near-term enterprise exposure if vulnerable assets remain unaddressed.";
  }

  if (text.includes("credential") || text.includes("phishing")) {
    return "This may increase the likelihood of user compromise, identity abuse, and downstream unauthorized access if preventive controls are weak.";
  }

  if (text.includes("ransomware") || text.includes("malware") || text.includes("trojan")) {
    return "This reflects active malicious tradecraft that could drive endpoint compromise, disruption, or broader operational impact.";
  }

  if (trend.category.toLowerCase().includes("reg")) {
    return "This may affect governance expectations, documentation requirements, or accountability obligations for enterprise programs.";
  }

  if (riskLevel === "high" || riskLevel === "critical") {
    return "This represents a high-priority development with meaningful risk implications if applicability is confirmed.";
  }

  return "This is relevant to enterprise monitoring and should be evaluated for applicability, exposure, and control sufficiency.";
}

function buildAction(trend: Trend, score: number): string {
  const text = `${trend.name} ${trend.description}`.toLowerCase();
  const riskLevel = normalizeRiskLevel(score);

  if (text.includes("zero-day") || text.includes("patch")) {
    return "Validate affected assets immediately, prioritize remediation, and monitor for exploitation attempts.";
  }

  if (text.includes("credential") || text.includes("phishing")) {
    return "Review identity protections, reinforce user-facing controls, and monitor for suspicious authentication or email activity.";
  }

  if (text.includes("ransomware") || text.includes("malware") || text.includes("trojan")) {
    return "Confirm endpoint coverage, review detections, and validate response readiness for compromise scenarios tied to this activity.";
  }

  if (trend.category.toLowerCase().includes("reg")) {
    return "Assess whether policies, governance documentation, reporting obligations, or control evidence should be updated.";
  }

  if (riskLevel === "high" || riskLevel === "critical") {
    return "Assign ownership immediately and determine whether escalation, mitigation, or executive visibility is required.";
  }

  return "Review for applicability and confirm whether existing controls remain appropriate.";
}

function buildExecutiveHeadline(trends: Trend[]): string {
  const highCount = trends.filter((trend) => toNumber(trend.score) >= 0.75).length;

  if (highCount >= 2) {
    return "Multiple high-priority cyber developments define this cycle and warrant immediate attention from security and risk leadership.";
  }

  if (highCount === 1) {
    return "A high-priority cyber development leads this cycle, supported by additional items relevant to enterprise risk posture.";
  }

  return "This issue summarizes the most relevant cyber risk developments in the current intelligence cycle.";
}

function normalizeTrend(trend: Trend, index: number) {
  const score = toNumber(trend.score);
  const riskLevel = normalizeRiskLevel(score);

  return {
    rank: index + 1,
    trendId: trend.id,
    title: trend.name,
    category: trend.category,
    score,
    riskLevel,
    summary: trend.description,
    whyItMatters: buildWhyItMatters(trend, score),
    recommendedAction: buildAction(trend, score)
  };
}

function buildMarkdown(trends: Trend[]): string {
  if (trends.length === 0) {
    return "# SecureLogic Cyber Risk Intelligence Brief\n\nNo significant trend items were available.";
  }

  const normalized = trends.map(normalizeTrend);

  const body = normalized
    .map((trend) =>
      [
        `## ${trend.rank}. ${trend.title}`,
        "",
        `Risk Level: ${trend.riskLevel}`,
        `Category: ${trend.category}`,
        `Score: ${trend.score.toFixed(2)}`,
        "",
        `Why it matters: ${trend.whyItMatters}`,
        "",
        `Recommended action: ${trend.recommendedAction}`
      ].join("\n")
    )
    .join("\n\n");

  return [
    "# SecureLogic Cyber Risk Intelligence Brief",
    "",
    buildExecutiveHeadline(trends),
    "",
    body
  ].join("\n");
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
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:960px;margin:0 auto;padding:24px;">
  <h1>SecureLogic Cyber Risk Intelligence Brief</h1>
  <p>No significant trend items were available.</p>
</body>
</html>
    `.trim();
  }

  const normalized = trends.map(normalizeTrend);

  const body = normalized
    .map((trend) => {
      const riskColor =
        trend.riskLevel === "critical"
          ? "#dc2626"
          : trend.riskLevel === "high"
            ? "#ea580c"
            : trend.riskLevel === "medium"
              ? "#ca8a04"
              : "#16a34a";

      return `
        <section style="border-left:4px solid ${riskColor};background:#f9fafb;padding:16px;margin-bottom:16px;border-radius:8px;">
          <h2 style="margin:0 0 8px 0;">${trend.rank}. ${escapeHtml(trend.title)}</h2>
          <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">
            ${escapeHtml(trend.category)} • ${escapeHtml(trend.riskLevel.toUpperCase())} • Score ${trend.score.toFixed(2)}
          </div>
          <div style="margin-bottom:10px;"><strong>Why it matters:</strong> ${escapeHtml(trend.whyItMatters)}</div>
          <div><strong>Recommended action:</strong> ${escapeHtml(trend.recommendedAction)}</div>
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
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:960px;margin:0 auto;padding:24px;background:#ffffff;">
  <div style="margin-bottom:24px;">
    <div style="font-size:30px;font-weight:800;">SecureLogic Cyber Risk Intelligence Brief</div>
    <p style="font-size:16px;color:#374151;">${escapeHtml(buildExecutiveHeadline(trends))}</p>
  </div>
  ${body}
</body>
</html>
  `.trim();
}

function buildSummary(trends: Trend[]): string {
  const highCount = trends.filter((trend) => toNumber(trend.score) >= 0.75).length;

  if (highCount > 0) {
    return `This issue highlights ${highCount} high-priority cyber risk development(s) requiring attention, alongside broader intelligence themes relevant to security and risk leadership.`;
  }

  return `Top ${trends.length} cyber risk items generated for the current intelligence window.`;
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
  const normalized = trends.map(normalizeTrend);

  await createIssue({
    organizationId,
    title: "SecureLogic Cyber Risk Intelligence Brief",
    status: "draft",
    audienceTier: "standard",
    summary: buildSummary(trends),
    sectionsJson: {
      executiveHeadline: buildExecutiveHeadline(trends),
      topItems: normalized
    },
    contentMd: buildMarkdown(trends),
    contentHtml: buildHtml(trends)
  });

  console.log("Newsletter issue created for organization:", organizationId);
  return 1;
}
