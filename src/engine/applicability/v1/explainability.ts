/**
 * explainability.ts — Slice 5 (S5): the pure Explainability layer over a PERSISTED
 * applicability decision (4b tables). I/O-free and deterministic: it renders a
 * stored decision into an auditor-defensible, human-readable explanation —
 * the reasoning chain, the evidence used and the evidence missing, a business
 * "why this matters" framing tied to the blast radius, and a reproducibility
 * statement that re-derives the content hash from the stored inputs (AD-16 #4).
 *
 * It reads ONLY stored fields (the DONE bar: "reasoning chain renders from stored
 * data") — no DB, no engine re-run, no LLM. A later slice may add an optional LLM
 * *narration* on top (AD-7), but the structured explanation here is the source and
 * is complete on its own.
 */

import {
  computeContentHash,
  type AssessmentIdentity,
  type EvidenceSnapshot
} from "./contentHash.js";
import type {
  ApplicabilityDecision,
  ApplicabilityResult,
  AffectedEntity,
  ReasoningStep
} from "./types.js";

/** A decision as read back from the 4b tables (header + evidence + affected children). */
export interface StoredAssessment {
  organization_id: string;
  signal_id: string;
  target_type: AssessmentIdentity["target_type"];
  target_id: string;
  decision: ApplicabilityDecision;
  confidence: number;
  confidence_band: ApplicabilityResult["confidence_band"];
  reasoning_steps: ReasoningStep[];
  affected_entities: AffectedEntity[];
  evidence: EvidenceSnapshot[];
  engine_version: string;
  schema_version: string;
  content_hash: string;
  prev_hash: string;
}

/** Evidence categories an auditor expects to see backing a decision. */
export const EVIDENCE_CATEGORIES = ["match", "graph_reachability"] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/** Map a raw evidence_type to its auditor category. Unknown types map to "match". */
function categoryOf(evidenceType: string): EvidenceCategory {
  const t = evidenceType.toLowerCase();
  if (t.includes("graph") || t.includes("edge") || t.includes("reach") || t.includes("relationship")) {
    return "graph_reachability";
  }
  return "match";
}

export interface BlastRadiusGroup {
  node_type: string;
  count: number;
  min_depth: number;
}

export interface AssessmentExplanation {
  /** One-line business framing — "why this matters". */
  headline: string;
  /** Decision + confidence stated plainly. */
  decision_statement: string;
  /** The ordered deterministic rule trace, rendered. */
  reasoning_chain: string[];
  /** Evidence categories actually present, with counts. */
  evidence_used: Array<{ category: EvidenceCategory; count: number; types: string[] }>;
  /** Expected evidence categories with zero rows — the honest gaps in the basis. */
  evidence_missing: EvidenceCategory[];
  /** Blast radius grouped by node type (the answer the flat matcher can't give). */
  blast_radius: BlastRadiusGroup[];
  /** Total affected entities. */
  affected_count: number;
  /** Reproducibility + tamper-evidence statement. */
  reproducibility: {
    engine_version: string;
    schema_version: string;
    content_hash: string;
    prev_hash: string;
    /** True iff recomputing the hash from the stored inputs reproduces content_hash. */
    reproduces: boolean;
  };
}

const DECISION_PHRASING: Record<ApplicabilityDecision, string> = {
  affected: "applies to your environment",
  potentially_affected: "may apply to your environment",
  not_affected: "does not appear to apply to your environment",
  needs_review: "matched but could not be scored automatically and needs human review",
  unknown: "could not be assessed from the available structured inputs"
};

function pluralize(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  let plural: string;
  if (/[^aeiou]y$/.test(word)) plural = `${word.slice(0, -1)}ies`; // entity -> entities, identity -> identities
  else if (/(s|x|z|ch|sh)$/.test(word)) plural = `${word}es`;
  else plural = `${word}s`;
  return `${n} ${plural}`;
}

/** Group affected entities by node_type, deterministically, tracking the shallowest depth. */
function groupBlastRadius(affected: AffectedEntity[]): BlastRadiusGroup[] {
  const byType = new Map<string, { count: number; min_depth: number }>();
  for (const a of affected) {
    const g = byType.get(a.node_type);
    if (!g) byType.set(a.node_type, { count: 1, min_depth: a.min_depth });
    else {
      g.count += 1;
      if (a.min_depth < g.min_depth) g.min_depth = a.min_depth;
    }
  }
  return [...byType.entries()]
    .map(([node_type, g]) => ({ node_type, count: g.count, min_depth: g.min_depth }))
    .sort((x, y) => (x.node_type < y.node_type ? -1 : x.node_type > y.node_type ? 1 : 0));
}

function buildHeadline(a: StoredAssessment, affectedCount: number): string {
  const verb = DECISION_PHRASING[a.decision];
  if (a.decision === "affected" || a.decision === "potentially_affected") {
    const reach =
      affectedCount > 0
        ? `, reaching ${pluralize(affectedCount, "downstream entity")}`
        : " (no downstream reach recorded)";
    return `This signal ${verb} (${a.confidence}% confidence)${reach}.`;
  }
  return `This signal ${verb} (${a.confidence}% confidence).`;
}

/** Reconstruct the engine result shape from the stored header, for hash re-derivation. */
function toResult(a: StoredAssessment): ApplicabilityResult {
  return {
    decision: a.decision,
    confidence: a.confidence,
    confidence_band: a.confidence_band,
    reasoning_steps: a.reasoning_steps,
    affected_entities: a.affected_entities,
    engine_version: a.engine_version,
    schema_version: a.schema_version
  };
}

/**
 * Render a stored applicability decision into a structured, auditor-defensible
 * explanation. Pure and deterministic — same stored row → same explanation.
 */
export function explainAssessment(a: StoredAssessment): AssessmentExplanation {
  const affectedCount = a.affected_entities.length;

  // Evidence used, grouped by category (deterministic ordering).
  const byCategory = new Map<EvidenceCategory, { count: number; types: Set<string> }>();
  for (const e of a.evidence) {
    const cat = categoryOf(e.evidence_type);
    const g = byCategory.get(cat);
    if (!g) byCategory.set(cat, { count: 1, types: new Set([e.evidence_type]) });
    else {
      g.count += 1;
      g.types.add(e.evidence_type);
    }
  }
  const evidence_used = EVIDENCE_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => {
    const g = byCategory.get(category)!;
    return { category, count: g.count, types: [...g.types].sort() };
  });
  const evidence_missing = EVIDENCE_CATEGORIES.filter((c) => !byCategory.has(c));

  const reasoning_chain = a.reasoning_steps.map(
    (s, i) => `${i + 1}. [${s.rule_id}] ${s.inputs_considered} → ${s.outcome}`
  );

  // Reproducibility: re-derive the content hash from the stored inputs.
  const identity: AssessmentIdentity = {
    organization_id: a.organization_id,
    signal_id: a.signal_id,
    target_type: a.target_type,
    target_id: a.target_id
  };
  const recomputed = computeContentHash(identity, toResult(a), a.evidence, a.prev_hash);

  return {
    headline: buildHeadline(a, affectedCount),
    decision_statement: `Decision: ${a.decision} (${a.confidence_band} confidence band, ${a.confidence}/100).`,
    reasoning_chain,
    evidence_used,
    evidence_missing,
    blast_radius: groupBlastRadius(a.affected_entities),
    affected_count: affectedCount,
    reproducibility: {
      engine_version: a.engine_version,
      schema_version: a.schema_version,
      content_hash: a.content_hash,
      prev_hash: a.prev_hash,
      reproduces: recomputed === a.content_hash
    }
  };
}

/** Render the structured explanation to plain text (e.g. for an export/report). */
export function renderExplanationText(x: AssessmentExplanation): string {
  const lines: string[] = [];
  lines.push(x.headline);
  lines.push("");
  lines.push(x.decision_statement);
  lines.push("");
  lines.push("Reasoning:");
  for (const step of x.reasoning_chain) lines.push(`  ${step}`);
  lines.push("");
  if (x.blast_radius.length > 0) {
    lines.push(`Blast radius (${x.affected_count}):`);
    for (const g of x.blast_radius) {
      lines.push(`  ${pluralize(g.count, g.node_type)} (nearest depth ${g.min_depth})`);
    }
    lines.push("");
  }
  lines.push("Evidence used:");
  if (x.evidence_used.length === 0) lines.push("  (none recorded)");
  for (const e of x.evidence_used) lines.push(`  ${e.category}: ${pluralize(e.count, "item")} (${e.types.join(", ")})`);
  if (x.evidence_missing.length > 0) lines.push(`Evidence missing: ${x.evidence_missing.join(", ")}`);
  lines.push("");
  lines.push(
    `Reproducibility: engine ${x.reproducibility.engine_version}, schema ${x.reproducibility.schema_version}; ` +
      `content hash ${x.reproducibility.content_hash.slice(0, 12)}… ` +
      `(${x.reproducibility.reproduces ? "re-derives from stored inputs" : "DOES NOT re-derive — tampering suspected"}).`
  );
  return lines.join("\n");
}
