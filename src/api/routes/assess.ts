import { Router } from "express";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { logger } from "../infra/logger.js";
import { pg } from "../infra/postgres.js";
import { RunnerEngine } from "../../engine/RunnerEngine.js";
import type { EngineInput } from "../../engine/contracts/EngineInput.js";

const router = Router();

const VALID_SCALES = new Set(["Small", "Medium", "Enterprise"]);

type ApprovalStatus = "Approved" | "Conditional" | "Rejected";

function severityToApprovalStatus(severity: string): ApprovalStatus {
  if (severity === "Low") return "Approved";
  if (severity === "Moderate") return "Conditional";
  return "Rejected";
}

function severityToNumericScore(severity: string): number {
  if (severity === "Low") return 20;
  if (severity === "Moderate") return 50;
  if (severity === "High") return 75;
  return 95; // Critical
}

/**
 * Strict runtime validation of the EngineInput shape.
 */
function validateAssessmentInput(body: unknown): { input: EngineInput } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // --- client ---
  if (!b.client || typeof b.client !== "object" || Array.isArray(b.client)) {
    return { error: "client_required" };
  }

  const client = b.client as Record<string, unknown>;

  if (typeof client.name !== "string" || !client.name.trim()) {
    return { error: "client.name_required" };
  }

  if (typeof client.industry !== "string" || !client.industry.trim()) {
    return { error: "client.industry_required" };
  }

  if (typeof client.assessmentType !== "string" || !client.assessmentType.trim()) {
    return { error: "client.assessmentType_required" };
  }

  if (typeof client.scope !== "string" || !client.scope.trim()) {
    return { error: "client.scope_required" };
  }

  // --- context ---
  if (!b.context || typeof b.context !== "object" || Array.isArray(b.context)) {
    return { error: "context_required" };
  }

  const context = b.context as Record<string, unknown>;

  if (typeof context.regulated !== "boolean") {
    return { error: "context.regulated_must_be_boolean" };
  }

  if (typeof context.safetyCritical !== "boolean") {
    return { error: "context.safetyCritical_must_be_boolean" };
  }

  if (typeof context.handlesPII !== "boolean") {
    return { error: "context.handlesPII_must_be_boolean" };
  }

  if (!VALID_SCALES.has(context.scale as string)) {
    return { error: "context.scale_must_be_Small_Medium_or_Enterprise" };
  }

  // --- answers ---
  if (!b.answers || typeof b.answers !== "object" || Array.isArray(b.answers)) {
    return { error: "answers_required" };
  }

  const answers = b.answers as Record<string, unknown>;
  const answerEntries = Object.entries(answers);

  if (answerEntries.length === 0) {
    return { error: "answers_must_not_be_empty" };
  }

  for (const [key, val] of answerEntries) {
    if (typeof key !== "string" || !key.trim()) {
      return { error: "answers_keys_must_be_non_empty_strings" };
    }

    if (typeof val !== "boolean") {
      return { error: `answers.${key}_must_be_boolean` };
    }
  }

  const input: EngineInput = {
    client: {
      name: (client.name as string).trim(),
      industry: (client.industry as string).trim(),
      assessmentType: (client.assessmentType as string).trim(),
      scope: (client.scope as string).trim()
    },
    context: {
      regulated: context.regulated as boolean,
      safetyCritical: context.safetyCritical as boolean,
      handlesPII: context.handlesPII as boolean,
      scale: context.scale as "Small" | "Medium" | "Enterprise"
    },
    answers: answers as Record<string, boolean>
  };

  return { input };
}

/**
 * Persist the completed assessment, its findings, and its report
 * to Postgres in a single transaction.
 *
 * Returns the DB-generated assessment UUID.
 */
async function persistAssessment(
  organizationId: string,
  input: EngineInput,
  result: Awaited<ReturnType<RunnerEngine["run"]>>,
  severity: string,
  framework: string
): Promise<string> {
  const { report } = result;
  const riskScore = severityToNumericScore(severity);

  const client = await pg.connect();

  try {
    await client.query("BEGIN");

    // 1. Insert assessment row
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
      VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, NOW(), NOW())
      RETURNING id
      `,
      [
        organizationId,
        input.client.assessmentType,
        framework,
        input.client.name,
        JSON.stringify({ scope: input.client.scope }),
        JSON.stringify(input.context),
        JSON.stringify({ client: input.client, context: input.context, answers: input.answers })
      ]
    );

    const assessmentId: string = assessmentResult.rows[0].id;

    // 2. Insert findings (bulk — one per engine finding)
    if (report.findings.length > 0) {
      const findingValues: unknown[] = [];
      const findingPlaceholders: string[] = [];

      report.findings.forEach((f, i) => {
        const base = i * 6;
        findingPlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        findingValues.push(
          assessmentId,
          f.title,
          f.severity,
          f.businessImpact ?? "",
          f.recommendation ?? "",
          f.id
        );
      });

      await client.query(
        `
        INSERT INTO findings (assessment_id, title, severity, description, recommendation, framework_control_id)
        VALUES ${findingPlaceholders.join(", ")}
        `,
        findingValues
      );
    }

    // 3. Insert report row
    await client.query(
      `
      INSERT INTO reports (assessment_id, type, risk_score, summary, report_json, generated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [
        assessmentId,
        "engine_v2",
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
}

/* =========================================================
   POST /assess
   Run the core risk engine and persist the result.
   ========================================================= */

router.post(
  "/assess",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const startedAt = Date.now();

    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const validated = validateAssessmentInput(req.body);

      if ("error" in validated) {
        res.status(400).json({ error: validated.error });
        return;
      }

      const { input } = validated;

      // Run the engine
      const engine = new RunnerEngine();
      const result = await engine.run(input);

      const { decision } = result;
      const severity = decision.severity;
      const drivers: string[] = decision.drivers ?? [];
      const trace = (decision as any).trace ?? null;

      const framework: string = trace?.framework ?? "MultiFramework";
      const engineVersion: string = trace?.metadata?.engineVersion ?? "0.3.2";
      const generatedAt: string = trace?.metadata?.generatedAt ?? new Date().toISOString();
      const approvalStatus = severityToApprovalStatus(severity);
      const dominantDomains: string[] = [...new Set(drivers)].slice(0, 5);

      // Persist to DB — returns the canonical DB assessment UUID
      let assessmentId: string;
      try {
        assessmentId = await persistAssessment(organizationId, input, result, severity, framework);
      } catch (dbErr) {
        logger.error(
          { event: "assessment_persist_failed", dbErr },
          "POST /api/assess: DB persist failed"
        );
        res.status(500).json({ error: "assessment_persist_failed" });
        return;
      }

      const durationMs = Date.now() - startedAt;

      logger.info(
        {
          event: "assessment_completed",
          assessmentId,
          organizationId,
          severity,
          approvalStatus,
          findingCount: result.report.findings.length,
          durationMs
        },
        "POST /api/assess: assessment completed and persisted"
      );

      res.status(201).json({
        assessmentId,
        organizationId,
        decision: {
          severity,
          approvalStatus,
          drivers,
          dominantDomains
        },
        findingCount: result.report.findings.length,
        meta: {
          engineVersion,
          framework,
          generatedAt,
          durationMs
        }
      });
    } catch (err) {
      logger.error(
        { event: "assessment_failed", err },
        "POST /api/assess: engine run failed"
      );

      res.status(500).json({ error: "assessment_failed" });
    }
  }
);

export default router;
