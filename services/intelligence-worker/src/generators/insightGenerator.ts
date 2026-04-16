import { pg } from "../../../../src/api/infra/postgres.js";

type Signal = {
  id: string;
  organization_id: string | null;
  category: string | null;
  title: string;
  summary: string | null;
  raw_content: string | null;
  source: string;
  source_url: string;
};

function buildText(signal: Signal): string {
  return `${signal.title} ${signal.raw_content ?? signal.summary ?? ""}`.toLowerCase();
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

export function deriveRiskImplication(_signal: Signal, _text: string): string {
  // Intentionally empty — newsletterBuilder LLM generates real risk implications
  // from raw content rather than propagating template strings into the DB.
  return "";
}

export function deriveAnalysis(signal: Signal, _text: string): string {
  // Return raw source content as the floor for downstream LLM synthesis.
  // The newsletterBuilder will pass this to analyzeSignal() instead of
  // a template string, so the model has actual source material to work from.
  return signal.raw_content ?? signal.summary ?? signal.title;
}

export function deriveRecommendation(_text: string): string {
  // Intentionally empty — newsletterBuilder LLM generates real recommendations
  // from raw content rather than propagating template strings into the DB.
  return "";
}

export async function generateInsights(): Promise<number> {
  const signalResult = await pg.query(`
    SELECT
      id,
      organization_id,
      category,
      title,
      summary,
      raw_content,
      source,
      source_url
    FROM signals
    ORDER BY created_at DESC
    LIMIT 50
  `);

  const signals = signalResult.rows as Signal[];
  let createdOrUpdated = 0;

  for (const signal of signals) {
    const organizationId = signal.organization_id ?? null;
    const text = buildText(signal);
    const riskLevel = deriveRiskLevel(text);
    const audience = deriveAudience(text);
    const analysis = deriveAnalysis(signal, text);
    const riskImplication = deriveRiskImplication(signal, text);
    const recommendation = deriveRecommendation(text);

    const values = [
      organizationId,
      signal.id,
      signal.title,
      analysis,
      riskImplication,
      recommendation,
      riskLevel,
      audience,
      signal.category ?? "GENERAL",
      false,
      JSON.stringify([signal.source_url])
    ];

    if (organizationId === null) {
      // Platform signal: de-dupe against uq_insights_platform_signal (signal_id WHERE org IS NULL)
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
          category,
          published,
          linked_sources,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
        ON CONFLICT (signal_id)
        WHERE organization_id IS NULL
        DO UPDATE SET
          title = EXCLUDED.title,
          analysis = EXCLUDED.analysis,
          risk_implication = EXCLUDED.risk_implication,
          recommendation = EXCLUDED.recommendation,
          risk_level = EXCLUDED.risk_level,
          audience = EXCLUDED.audience,
          category = EXCLUDED.category,
          published = EXCLUDED.published,
          linked_sources = EXCLUDED.linked_sources,
          updated_at = NOW()
        `,
        values
      );
    } else {
      // Org-scoped signal: de-dupe against uq_insights_org_signal (org, signal WHERE org IS NOT NULL)
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
          category,
          published,
          linked_sources,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
        ON CONFLICT (organization_id, signal_id)
        WHERE organization_id IS NOT NULL
        DO UPDATE SET
          title = EXCLUDED.title,
          analysis = EXCLUDED.analysis,
          risk_implication = EXCLUDED.risk_implication,
          recommendation = EXCLUDED.recommendation,
          risk_level = EXCLUDED.risk_level,
          audience = EXCLUDED.audience,
          category = EXCLUDED.category,
          published = EXCLUDED.published,
          linked_sources = EXCLUDED.linked_sources,
          updated_at = NOW()
        `,
        values
      );
    }

    createdOrUpdated++;
  }

  return createdOrUpdated;
}
