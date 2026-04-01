import { pg } from "../../../../src/api/infra/postgres.js";

type Signal = {
  id: string;
  organization_id: string | null;
  title: string;
  summary: string | null;
  source: string;
  source_url: string;
};

function buildText(signal: Signal): string {
  return `${signal.title} ${signal.summary ?? ""}`.toLowerCase();
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function deriveRiskLevel(text: string): "high" | "medium" | "low" {
  if (
    includesAny(text, [
      "zero-day",
      "0-day",
      "actively exploited",
      "under active exploitation",
      "ransomware",
      "credential theft",
      "phishing",
      "trojan",
      "malware",
      "casbaneiro",
      "exploit"
    ])
  ) {
    return "high";
  }

  if (
    includesAny(text, [
      "guidance",
      "regulation",
      "enforcement",
      "compliance",
      "ai act",
      "governance",
      "verification",
      "developer verification"
    ])
  ) {
    return "medium";
  }

  return "low";
}

function deriveAudience(text: string): string {
  if (
    includesAny(text, [
      "zero-day",
      "0-day",
      "actively exploited",
      "under active exploitation",
      "ransomware",
      "phishing",
      "trojan",
      "malware",
      "exploit"
    ])
  ) {
    return "Security Operations, IT Administrators, Security Leaders, Risk Teams";
  }

  if (
    includesAny(text, [
      "ai model",
      "open-source ai",
      "open source ai",
      "ai governance",
      "llm",
      "foundation model",
      "model governance"
    ])
  ) {
    return "AI Governance Leaders, Compliance Teams, Risk Teams, Executive Leadership";
  }

  if (
    includesAny(text, [
      "guidance",
      "regulation",
      "enforcement",
      "compliance",
      "ai act",
      "regulator"
    ])
  ) {
    return "Compliance Teams, Legal Teams, Risk Teams, Executive Leadership";
  }

  return "Security Leaders, Risk Teams";
}

function deriveRiskImplication(signal: Signal, text: string): string {
  if (
    includesAny(text, [
      "zero-day",
      "0-day",
      "actively exploited",
      "under active exploitation",
      "exploit"
    ])
  ) {
    return `This development indicates a time-sensitive exposure scenario tied to "${signal.title}" and may require accelerated patching, exposure validation, and compensating control review.`;
  }

  if (includesAny(text, ["phishing", "credential", "pdf lure", "casbaneiro"])) {
    return `This development indicates heightened credential and endpoint risk tied to "${signal.title}" and raises the likelihood of user-targeted compromise attempts against enterprise staff.`;
  }

  if (
    includesAny(text, [
      "ai model",
      "open-source ai",
      "open source ai",
      "ai governance",
      "llm"
    ])
  ) {
    return `This development may expand unmanaged AI usage risk, model governance exposure, and policy gaps if the organization does not have clear approval and oversight controls.`;
  }

  if (
    includesAny(text, [
      "guidance",
      "regulation",
      "enforcement",
      "ai act",
      "verification"
    ])
  ) {
    return `This development may change external expectations for governance, documentation, accountability, or compliance readiness and should be reviewed for policy impact.`;
  }

  return `This development may affect enterprise security, governance, or compliance posture and should be reviewed for direct operational impact.`;
}

function deriveAnalysis(signal: Signal, text: string): string {
  if (
    includesAny(text, [
      "zero-day",
      "0-day",
      "actively exploited",
      "under active exploitation"
    ])
  ) {
    return `The event reported in "${signal.title}" represents an actively exploitable security condition with direct enterprise relevance. Organizations should assume elevated exposure risk until patch status, internet-facing footprint, and endpoint coverage are validated.`;
  }

  if (includesAny(text, ["phishing", "credential", "pdf lure", "casbaneiro"])) {
    return `The event reported in "${signal.title}" reflects active social engineering and credential compromise tradecraft. This is especially relevant for organizations with inconsistent phishing resistance, weak browser hardening, or limited detection coverage for malicious document activity.`;
  }

  if (
    includesAny(text, [
      "ai model",
      "open-source ai",
      "open source ai",
      "ai governance",
      "llm",
      "foundation model"
    ])
  ) {
    return `The development reported in "${signal.title}" highlights AI governance questions around model use, approval boundaries, transparency, and downstream business risk. Enterprises adopting new AI capabilities should evaluate oversight, acceptable use constraints, and monitoring expectations before broader deployment.`;
  }

  if (
    includesAny(text, [
      "guidance",
      "regulation",
      "enforcement",
      "ai act",
      "verification",
      "regulator"
    ])
  ) {
    return `The development reported in "${signal.title}" may increase external expectations around governance, documentation, and accountability. Organizations should evaluate whether current policies, control evidence, and operating procedures align with the direction of travel reflected in this update.`;
  }

  return `The development reported in "${signal.title}" may affect enterprise governance, security, or compliance posture and should be reviewed to determine whether internal controls or monitoring priorities need to change.`;
}

function deriveRecommendation(text: string): string {
  if (
    includesAny(text, [
      "zero-day",
      "0-day",
      "actively exploited",
      "under active exploitation",
      "exploit"
    ])
  ) {
    return "Validate asset exposure immediately, confirm patch or mitigation status, review internet-facing footprint, and ensure detection content is updated for related exploitation activity.";
  }

  if (includesAny(text, ["phishing", "credential", "pdf lure", "casbaneiro"])) {
    return "Review email and web filtering coverage, validate browser and endpoint protections, reinforce phishing-resistant MFA, and hunt for suspicious document-driven credential theft activity.";
  }

  if (
    includesAny(text, [
      "ai model",
      "open-source ai",
      "open source ai",
      "ai governance",
      "llm",
      "foundation model"
    ])
  ) {
    return "Confirm AI usage policy boundaries, approval workflows, model evaluation criteria, and monitoring expectations before permitting broader internal use.";
  }

  if (
    includesAny(text, [
      "guidance",
      "regulation",
      "enforcement",
      "ai act",
      "verification",
      "regulator"
    ])
  ) {
    return "Review governance documentation, control evidence, accountability assignments, and policy language to determine whether regulatory or policy updates are required.";
  }

  return "Review the development, assess direct relevance to your environment, and determine whether internal controls, monitoring priorities, or governance processes should be updated.";
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
    throw new Error("No organization found");
  }

  return organizationId;
}

export async function generateInsights(): Promise<number> {
  const defaultOrganizationId = await getDefaultOrganizationId();

  const signalResult = await pg.query(`
    SELECT
      id,
      organization_id,
      title,
      summary,
      source,
      source_url
    FROM signals
    ORDER BY created_at DESC
    LIMIT 50
  `);

  const signals = signalResult.rows as Signal[];
  let createdOrUpdated = 0;

  for (const signal of signals) {
    const organizationId = signal.organization_id ?? defaultOrganizationId;
    const text = buildText(signal);
    const riskLevel = deriveRiskLevel(text);
    const audience = deriveAudience(text);
    const analysis = deriveAnalysis(signal, text);
    const riskImplication = deriveRiskImplication(signal, text);
    const recommendation = deriveRecommendation(text);

    await pg.query(
      `
      INSERT INTO insights (
        organization_id,
        signal_id,
        title,
        analysis,
        risk_implication,
        recommendation,
        risk_level,
        audience,
        published,
        linked_sources,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
      ON CONFLICT (organization_id, signal_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        analysis = EXCLUDED.analysis,
        risk_implication = EXCLUDED.risk_implication,
        recommendation = EXCLUDED.recommendation,
        risk_level = EXCLUDED.risk_level,
        audience = EXCLUDED.audience,
        published = EXCLUDED.published,
        linked_sources = EXCLUDED.linked_sources,
        updated_at = NOW()
      `,
      [
        organizationId,
        signal.id,
        signal.title,
        analysis,
        riskImplication,
        recommendation,
        riskLevel,
        audience,
        false,
        JSON.stringify([signal.source_url])
      ]
    );

    createdOrUpdated++;
  }

  return createdOrUpdated;
}
