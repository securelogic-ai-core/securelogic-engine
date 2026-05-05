import { pg } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import { RunnerEngine } from "../../../../src/engine/RunnerEngine.js";
import type { EngineInput } from "../../../../src/engine/contracts/EngineInput.js";
import type { ScoredSignal } from "../models/Signal.js";
import type { Category } from "../constants/categories.js";

/**
 * Category → implied control answers.
 *
 * Each signal category implies a set of controls that are likely
 * failing or under stress. false = control is failing / at risk.
 * true = control is assumed present as baseline.
 *
 * This is not an assertion about the specific org — it is the
 * engine's worst-case interpretation of what the signal implies,
 * used to produce a risk decision with meaningful findings.
 */
const CATEGORY_ANSWERS: Record<Category, Record<string, boolean>> = {
  SECURITY_INCIDENT: {
    "SEC-001": false, // access controls failed or bypassed
    "SEC-003": false, // vulnerability scanning missed the vector
    "SEC-006": false, // adversarial defenses were insufficient
    "MON-001": false, // system monitoring did not detect the incident
    "MON-004": false, // incident playbook not triggered in time
    "GOV-002": true,  // risk ownership assumed defined
    "BC-001": true    // redundancy assumed present
  },
  // VULNERABILITY uses the same control mapping as SECURITY_INCIDENT until tuned per docs/brief-content-audit.md follow-up. Bug 1 (PR #43) added the category.
  VULNERABILITY: {
    "SEC-001": false,
    "SEC-003": false,
    "SEC-006": false,
    "MON-001": false,
    "MON-004": false,
    "GOV-002": true,
    "BC-001": true
  },
  REGULATION: {
    "GOV-001": false, // policy may not cover new requirement
    "GOV-002": false, // risk owner may not have assessed impact
    "GOV-004": false, // oversight committee hasn't reviewed
    "TRAN-003": true, // audit trails assumed present
    "TRAN-004": false // documentation may not reflect new obligations
  },
  AI_GOVERNANCE: {
    "GOV-001": false, // AI governance policy may not cover this
    "GOV-004": false, // oversight committee review needed
    "MD-001": false,  // validation testing may not address this
    "TRAN-001": false, // model cards may not be current
    "TRAN-006": false, // explainability mechanisms need review
    "HO-001": false   // human-in-loop controls need assessment
  },
  COMPLIANCE_UPDATE: {
    "GOV-001": false, // policy needs updating
    "TRAN-004": false, // documentation completeness at risk
    "TRAN-003": true,  // audit trails assumed present
    "GOV-003": true    // roles assumed defined
  },
  VENDOR_RISK: {
    "SEC-001": false,  // access controls on vendor interfaces at risk
    "GOV-003": false,  // vendor roles/responsibilities may be unclear
    "MON-001": false,  // monitoring of vendor systems may be insufficient
    "BC-003": false    // backup pipelines through vendor at risk
  },
  GENERAL: {
    "GOV-001": false,
    "MON-001": false,
    "TRAN-003": true
  }
};

function buildEngineInput(signal: ScoredSignal): EngineInput {
  const category = (signal.category as Category) ?? "GENERAL";
  const answers = CATEGORY_ANSWERS[category] ?? CATEGORY_ANSWERS.GENERAL;

  const content = `${signal.title} ${signal.summary ?? ""} ${signal.rawContent ?? ""}`.toLowerCase();

  const regulated =
    category === "REGULATION" ||
    category === "COMPLIANCE_UPDATE" ||
    /\b(gdpr|ccpa|hipaa|pci|sox|regulation|compliance)\b/.test(content);

  const safetyCritical =
    category === "SECURITY_INCIDENT" ||
    /\b(zero-?day|actively exploited|critical|ransomware|breach)\b/.test(content);

  const handlesPII =
    /\b(pii|personal data|personally identifiable|gdpr|privacy|user data)\b/.test(content);

  return {
    client: {
      name: signal.title.slice(0, 120),
      industry: "general",
      assessmentType: "signal_intelligence",
      scope: category
    },
    context: {
      regulated,
      safetyCritical,
      handlesPII,
      scale: "Enterprise"
    },
    answers
  };
}

function severityToNumericScore(severity: string): number {
  if (severity === "Low") return 20;
  if (severity === "Moderate") return 50;
  if (severity === "High") return 75;
  return 95; // Critical
}

/**
 * Run the core engine against an intelligence signal and persist
 * the resulting assessment, findings, and report to Postgres.
 *
 * Returns the DB-generated assessment UUID, or null if the engine
 * run or persist fails (non-fatal — worker cycle continues).
 */
export async function assessSignal(
  organizationId: string | null,
  signal: ScoredSignal
): Promise<string | null> {
  try {
    const input = buildEngineInput(signal);

    const engine = new RunnerEngine();
    const result = await engine.run(input);

    const { decision, report } = result;
    const severity = decision.severity;
    const riskScore = severityToNumericScore(severity);
    const trace = (decision as any).trace ?? null;
    const framework: string = trace?.framework ?? "MultiFramework";

    const client = await pg.connect();

    try {
      await client.query("BEGIN");

      // 1. Insert assessment
      const assessmentResult = await client.query(
        `
        INSERT INTO assessments (
          organization_id,
          type,
          framework,
          status,
          subject_name,
          scope,
          risk_context,
          intake_payload,
          submitted_at,
          completed_at
        )
        VALUES ($1, 'signal_intelligence', $2, 'completed', $3, $4, $5, $6, NOW(), NOW())
        RETURNING id
        `,
        [
          organizationId,
          framework,
          signal.title.slice(0, 120),
          JSON.stringify({ category: signal.category, source: signal.source }),
          JSON.stringify({
            regulated: input.context.regulated,
            safetyCritical: input.context.safetyCritical,
            handlesPII: input.context.handlesPII,
            scale: input.context.scale,
            signalCategory: signal.category,
            impactScore: signal.impactScore,
            noveltyScore: signal.noveltyScore,
            relevanceScore: signal.relevanceScore
          }),
          JSON.stringify({ answers: input.answers, signalId: signal.id })
        ]
      );

      const assessmentId: string = assessmentResult.rows[0].id;

      // 2. Insert findings (bulk)
      if (report.findings.length > 0) {
        const placeholders: string[] = [];
        const values: unknown[] = [];

        report.findings.forEach((f, i) => {
          const base = i * 6;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
          );
          values.push(
            assessmentId,
            f.title,
            f.severity,
            f.businessImpact ?? "",
            f.recommendation ?? "",
            f.id
          );
        });

        await client.query(
          `INSERT INTO findings (assessment_id, title, severity, description, recommendation, framework_control_id)
           VALUES ${placeholders.join(", ")}`,
          values
        );
      }

      // 3. Insert report
      await client.query(
        `
        INSERT INTO reports (assessment_id, type, risk_score, summary, report_json, generated_at)
        VALUES ($1, 'signal_intelligence', $2, $3, $4, NOW())
        `,
        [
          assessmentId,
          riskScore,
          report.executiveSummary.narrative,
          JSON.stringify({
            meta: report.meta,
            executiveSummary: report.executiveSummary,
            domainScores: report.domainScores
          })
        ]
      );

      await client.query("COMMIT");

      return assessmentId;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Non-fatal: log and continue. One failed assessment must not
    // stop the worker from processing the rest of the signal batch.
    logger.error({ event: "assess_signal_failed", title: signal.title, err }, "Signal assessment failed");
    return null;
  }
}
