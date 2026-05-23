/**
 * claudeAssessmentAnalyzer.ts
 *
 * Claude-backed analysis for vendor assessments.
 *
 * Two operations:
 *   - analyzeVendorSignalContext: Haiku — matches org signals against a vendor name
 *     to surface relevant threat intelligence before an assessment begins.
 *   - analyzeAssessmentDocument: Sonnet — extracts findings from a vendor-supplied
 *     document (SOC 2, pentest report, audit, policy, etc.).
 *
 * Both functions fail gracefully: return null when ANTHROPIC_API_KEY is absent
 * or any API call fails. Callers must handle null.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { logger } from "../infra/logger.js";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchedSignal = {
  title: string;
  relevance: string;
  severity: string;
  suggestedFindingTitle: string;
  suggestedFindingDescription: string;
};

export type VendorSignalContext = {
  matchedSignals: MatchedSignal[];
  overallRiskSummary: string;
  suggestedAssessmentSeverity: "Critical" | "High" | "Moderate" | "Low" | null;
};

export type DocumentFinding = {
  title: string;
  description: string;
  severity: "Critical" | "High" | "Moderate" | "Low" | "Informational";
  recommendation: string;
  evidenceQuote: string | null;
};

export type DocumentAnalysisResult = {
  documentType: string;
  vendorName: string | null;
  findings: DocumentFinding[];
  overallRiskSummary: string;
  suggestedAssessmentSeverity: "Critical" | "High" | "Moderate" | "Low" | null;
  keyStrengths: string[];
  keyGaps: string[];
};

// ---------------------------------------------------------------------------
// Runtime validation (A03-G1 / A08-G4)
//
// analyzeAssessmentDocument concatenates customer-uploaded document text into
// a Claude prompt. A prompt-injected or malformed response must NOT flow into
// the assessment record. Severity-bearing fields are validated against a
// closed enum; on ANY schema failure the caller rejects (returns null) rather
// than emitting a degraded record. Non-security cosmetic fields default
// leniently so a benignly-incomplete-but-well-typed response is not discarded.
// ---------------------------------------------------------------------------

const FINDING_SEVERITY = z.enum([
  "Critical",
  "High",
  "Moderate",
  "Low",
  "Informational"
]);

const SUGGESTED_SEVERITY = z.enum(["Critical", "High", "Moderate", "Low"]);

const DocumentFindingSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(4000),
  severity: FINDING_SEVERITY,
  recommendation: z.string().max(4000).optional().transform((v) => v ?? ""),
  evidenceQuote: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => v ?? null)
});

const DocumentAnalysisResultSchema = z.object({
  documentType: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : "Unknown")),
  vendorName: z.string().max(300).nullable().optional(),
  findings: z.array(DocumentFindingSchema).max(200),
  overallRiskSummary: z
    .string()
    .max(4000)
    .optional()
    .transform((v) =>
      v && v.trim().length > 0
        ? v
        : "Document analysis did not produce a risk summary."
    ),
  suggestedAssessmentSeverity: SUGGESTED_SEVERITY.nullable()
    .optional()
    .transform((v) => v ?? null),
  keyStrengths: z
    .array(z.string().max(1000))
    .max(100)
    .optional()
    .transform((v) => v ?? []),
  keyGaps: z
    .array(z.string().max(1000))
    .max(100)
    .optional()
    .transform((v) => v ?? [])
});

// ---------------------------------------------------------------------------
// analyzeVendorSignalContext  (Haiku — cost at scale)
// ---------------------------------------------------------------------------

/**
 * Match recent org signals against a vendor name to surface relevant
 * threat intelligence. Run this before showing an assessment form so
 * the assessor has context on current vendor-related threats.
 *
 * @param vendorName  The vendor being assessed.
 * @param signals     Recent signals from the org's cyber_signals table.
 */
export async function analyzeVendorSignalContext(
  vendorName: string,
  signals: Array<{
    id: string;
    title: string;
    severity: string;
    signal_type: string;
    normalized_summary: string;
    affected_vendor: string | null;
  }>,
  organizationId: string | null = null
): Promise<VendorSignalContext | null> {
  const client = getClient();
  if (!client) return null;

  if (signals.length === 0) return null;

  logger.info(
    {
      event: "llm_call_start",
      purpose: "vendor_signal_context",
      model: "claude-haiku-4-5-20251001",
      organizationId
    },
    "LLM call: vendor signal context"
  );

  const signalLines = signals
    .slice(0, 20)
    .map(
      (s) =>
        `[${s.severity}] ${s.title} (type: ${s.signal_type}${s.affected_vendor ? `, vendor: ${s.affected_vendor}` : ""}): ${s.normalized_summary.slice(0, 200)}`
    )
    .join("\n");

  const prompt = `You are a third-party risk analyst preparing context for a vendor security assessment.

Vendor being assessed: ${vendorName}

Recent signals from our threat intelligence feed:
${signalLines}

Identify which signals are directly relevant to ${vendorName} — either because they name ${vendorName} explicitly, mention products or services commonly associated with ${vendorName}, or represent a threat that would materially affect ${vendorName}'s security posture.

Return valid JSON only — no markdown, no code fences:
{
  "matchedSignals": [
    {
      "title": "signal title",
      "relevance": "1-2 sentences explaining why this signal is relevant to ${vendorName}",
      "severity": "Critical|High|Moderate|Low",
      "suggestedFindingTitle": "Short finding title if this warrants a finding",
      "suggestedFindingDescription": "1-2 sentences describing what to investigate or document in the assessment"
    }
  ],
  "overallRiskSummary": "2-3 sentences summarizing the current threat context for ${vendorName} based on matched signals",
  "suggestedAssessmentSeverity": "Critical|High|Moderate|Low|null"
}

If no signals match, return matchedSignals as an empty array, overallRiskSummary as "No current threat signals matched this vendor.", and suggestedAssessmentSeverity as null.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<VendorSignalContext>;

    return {
      matchedSignals: Array.isArray(parsed.matchedSignals) ? parsed.matchedSignals : [],
      overallRiskSummary: parsed.overallRiskSummary ?? "No current threat signals matched this vendor.",
      suggestedAssessmentSeverity: parsed.suggestedAssessmentSeverity ?? null
    };
  } catch (err) {
    logger.warn(
      { event: "vendor_signal_context_failed", vendorName, organizationId, err },
      "Vendor signal context analysis failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// analyzeComplianceContext  (Haiku — cost at scale)
// ---------------------------------------------------------------------------

export type ComplianceContext = {
  suggestedSeverity: "Critical" | "High" | "Moderate" | "Low" | null;
  suggestedSummary: string;
  riskIndicators: string[];
  assessmentGuidance: string;
};

/**
 * Generate a brief compliance context card for a control or obligation
 * before the assessor starts filling out the form.
 *
 * @param itemType        "control" or "obligation"
 * @param itemName        Name of the control or obligation.
 * @param itemDescription Optional description for more context.
 * @param recentFindings  Recent open findings linked to this item (titles + severities).
 */
export async function analyzeComplianceContext(
  itemType: "control" | "obligation",
  itemName: string,
  itemDescription: string | null,
  recentFindings: Array<{ title: string; severity: string }>
): Promise<ComplianceContext | null> {
  const client = getClient();
  if (!client) return null;

  const findingsText =
    recentFindings.length > 0
      ? recentFindings
          .slice(0, 10)
          .map((f) => `[${f.severity}] ${f.title}`)
          .join("\n")
      : "None";

  const prompt = `You are a compliance analyst preparing context for a ${itemType} assessment.

${itemType === "control" ? "Control" : "Obligation"}: ${itemName}
${itemDescription ? `Description: ${itemDescription}` : ""}

Recent open findings linked to this ${itemType}:
${findingsText}

Provide a brief compliance context to help the assessor focus their review.

Return valid JSON only — no markdown, no code fences:
{
  "suggestedSeverity": "Critical|High|Moderate|Low|null",
  "suggestedSummary": "1-2 sentence summary of what to look for in this assessment based on the ${itemType} name and any existing findings",
  "riskIndicators": ["up to 3 short risk indicators or focus areas for this ${itemType}"],
  "assessmentGuidance": "1-2 sentence practical guidance for the assessor on what evidence to gather or tests to perform"
}

If no meaningful context can be derived, set suggestedSeverity to null and provide generic but useful guidance.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ComplianceContext>;

    return {
      suggestedSeverity: parsed.suggestedSeverity ?? null,
      suggestedSummary: parsed.suggestedSummary ?? "",
      riskIndicators: Array.isArray(parsed.riskIndicators) ? parsed.riskIndicators : [],
      assessmentGuidance: parsed.assessmentGuidance ?? ""
    };
  } catch (err) {
    logger.warn({ event: "compliance_context_failed", itemType, itemName, err }, "Compliance context analysis failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// analyzeAiGovernanceContext  (Haiku — cost at scale)
// ---------------------------------------------------------------------------

/**
 * Generate AI governance assessment guidance for an AI system before the
 * assessor starts filling out the form. Returns the same ComplianceContext
 * shape as analyzeComplianceContext for UI reuse.
 */
export async function analyzeAiGovernanceContext(
  systemName: string,
  systemDescription: string | null,
  modelType: string | null,
  riskClassification: string | null,
  recentFindings: Array<{ title: string; severity: string; status: string }>
): Promise<ComplianceContext | null> {
  const client = getClient();
  if (!client) return null;

  const findingsText =
    recentFindings.length > 0
      ? JSON.stringify(recentFindings.slice(0, 10), null, 2)
      : "None";

  const prompt = `You are an AI governance analyst preparing to assess an AI system named '${systemName}'.

System details:
- Description/Use case: ${systemDescription ?? "Not provided"}
- Model type: ${modelType ?? "Not specified"}
- Risk classification: ${riskClassification ?? "Not classified"}

Recent findings for this system:
${findingsText}

Provide AI governance assessment guidance:
1. Suggested initial severity rating based on system type and risk classification
2. A suggested assessment summary starter
3. Key AI-specific risk indicators to investigate (consider: model bias, data privacy, explainability, regulatory compliance, security vulnerabilities, data drift, unintended outputs)
4. Specific governance assessment guidance for this type of AI system

Return valid JSON only — no markdown, no code fences:
{
  "suggestedSeverity": "Critical|High|Moderate|Low|null",
  "suggestedSummary": "1-2 sentence summary of what to assess for this AI system",
  "riskIndicators": ["up to 4 short AI-specific risk indicators"],
  "assessmentGuidance": "1-2 sentence practical guidance for assessing this AI system's governance posture"
}

If no meaningful context can be derived, set suggestedSeverity to null and provide generic but useful AI governance guidance.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ComplianceContext>;

    return {
      suggestedSeverity: parsed.suggestedSeverity ?? null,
      suggestedSummary: parsed.suggestedSummary ?? "",
      riskIndicators: Array.isArray(parsed.riskIndicators) ? parsed.riskIndicators : [],
      assessmentGuidance: parsed.assessmentGuidance ?? ""
    };
  } catch (err) {
    logger.warn({ event: "ai_governance_context_failed", systemName, err }, "AI governance context analysis failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// analyzeAssessmentDocument  (Sonnet — quality matters for document review)
// ---------------------------------------------------------------------------

/**
 * Extract findings from a vendor-supplied assessment document.
 * Accepts extracted text (from pdf-parse or similar) and returns structured findings.
 *
 * @param documentText  Raw text extracted from the uploaded document.
 * @param vendorName    Name of the vendor who produced the document.
 * @param documentHint  Optional hint about document type (e.g. "SOC 2 Type II report").
 */
export async function analyzeAssessmentDocument(
  documentText: string,
  vendorName: string,
  documentHint?: string,
  organizationId: string | null = null
): Promise<DocumentAnalysisResult | null> {
  const client = getClient();
  if (!client) return null;

  logger.info(
    {
      event: "llm_call_start",
      purpose: "vendor_doc_analysis",
      model: "claude-sonnet-4-6",
      organizationId
    },
    "LLM call: vendor document analysis"
  );

  // Truncate to ~30k chars to stay within context limits while preserving the
  // most actionable sections (executive summary, findings, exceptions).
  const excerpt = documentText.slice(0, 30000).replace(/\n{3,}/g, "\n\n").trim();

  const docTypeContext = documentHint
    ? `The user has indicated this is: ${documentHint}.`
    : "Identify the document type from its content (SOC 2, pentest report, ISO audit, security policy, etc.).";

  const prompt = `You are a senior third-party risk analyst reviewing a vendor-supplied security document as part of a vendor risk assessment.

Vendor: ${vendorName}
${docTypeContext}

Document text:
---
${excerpt}
---

Extract all security and compliance findings from this document. Focus on:
- Identified vulnerabilities, exceptions, or control failures
- Audit qualifications or scope limitations
- Unaddressed risks or open remediation items
- Data handling, access control, or privacy gaps
- Missing certifications or compliance gaps

Return valid JSON only — no markdown, no code fences:
{
  "documentType": "Detected document type (e.g. SOC 2 Type II, Penetration Test Report, ISO 27001 Audit, Security Policy)",
  "vendorName": "Vendor name as found in the document, or null if not found",
  "findings": [
    {
      "title": "Short finding title",
      "description": "2-3 sentences describing the finding and its context",
      "severity": "Critical|High|Moderate|Low|Informational",
      "recommendation": "Specific remediation or follow-up action",
      "evidenceQuote": "Direct quote from the document supporting this finding, or null"
    }
  ],
  "overallRiskSummary": "2-3 sentences summarizing the vendor's security posture based on this document",
  "suggestedAssessmentSeverity": "Critical|High|Moderate|Low|null",
  "keyStrengths": ["strength 1", "strength 2"],
  "keyGaps": ["gap 1", "gap 2"]
}

If the document contains no security findings, return an empty findings array with an appropriate overallRiskSummary.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(cleaned);
    } catch {
      logger.warn(
        { event: "document_analysis_invalid_json", vendorName, organizationId },
        "Assessment document analysis: response did not JSON-parse — rejecting (A03-G1)"
      );
      return null;
    }

    const validated = DocumentAnalysisResultSchema.safeParse(parsedUnknown);
    if (!validated.success) {
      logger.warn(
        {
          event: "document_analysis_invalid_shape",
          vendorName,
          organizationId,
          issues: validated.error.issues.slice(0, 10)
        },
        "Assessment document analysis: response failed schema validation — rejecting (A03-G1)"
      );
      return null;
    }

    const d = validated.data;
    return {
      documentType: d.documentType,
      vendorName: d.vendorName ?? vendorName,
      findings: d.findings,
      overallRiskSummary: d.overallRiskSummary,
      suggestedAssessmentSeverity: d.suggestedAssessmentSeverity,
      keyStrengths: d.keyStrengths,
      keyGaps: d.keyGaps
    };
  } catch (err) {
    logger.warn(
      { event: "document_analysis_failed", vendorName, organizationId, err },
      "Assessment document analysis failed"
    );
    return null;
  }
}
