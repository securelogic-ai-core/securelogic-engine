/**
 * claims.ts — the provenance model.
 *
 * Four claim classes, structurally separated, with citation verification that is
 * a CHECK rather than a request.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Ask's only defence against invention was a prompt paragraph beginning
 * "CRITICAL — never invent, assume, or generate proper nouns…". A prompt is a
 * request. It is also the least verifiable control surface in the product,
 * because an LLM turns a value into prose phrased differently every time — there
 * is no string to grep for and no rendering test that fails.
 *
 * Because every fact now arrives through a recorded tool invocation with a known
 * output, an OBSERVED claim can be checked against the data it cites. A claim
 * that asserts a value not present in its cited tool result is rejected before
 * it is ever rendered.
 *
 * ── The four classes ───────────────────────────────────────────────────────
 *
 *   observed        a value read directly from a canonical object. MUST cite a
 *                   tool invocation, and the value MUST appear in that output.
 *   derived         computed by a platform-owned deterministic function whose
 *                   basis is persisted (residual_basis, inherent_basis,
 *                   score_basis). Cites the basis record.
 *   inference       the model's own reasoning over observed/derived facts. MUST
 *                   be labelled as inference in the UI and MUST list the facts
 *                   it reasoned from. Never rendered as a system value.
 *   recommendation  a proposed next step. Carries an action class.
 *
 * The distinction is not cosmetic. A CISO acting on "your residual risk is High"
 * needs to know whether that is a stored rating, a computation with a visible
 * basis, or a model's opinion — and today all three would render identically.
 */

/** Ordered strongest-evidence-first. */
export const CLAIM_CLASSES = ["observed", "derived", "inference", "recommendation"] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];

/** Points at the tool invocation that produced the value. */
export type ClaimCitation = {
  /** Index into the turn's recorded invocations. Resolves to an ask_tool_invocations row. */
  invocation_index: number;
  tool_name: string;
  /** The canonical object, when the claim is about one. */
  object_type?: string;
  object_id?: string;
  /** The field quoted, for an observed claim. */
  field?: string;
  /** The value asserted — this is what verification checks. */
  value?: unknown;
};

export type Claim = {
  text: string;
  claim_class: ClaimClass;
  citations: ClaimCitation[];
  /** For `inference`: the claim indices it reasoned from. */
  derived_from?: number[];
};

export type VerificationIssue = {
  claim_index: number;
  reason:
    | "observed_without_citation"
    | "citation_out_of_range"
    | "value_not_in_tool_output"
    | "cited_tool_was_denied"
    | "inference_without_basis";
  detail: string;
};

export type VerifiedClaims = {
  claims: Claim[];
  issues: VerificationIssue[];
  /** True when every claim survived unchanged. */
  clean: boolean;
};

/** What verification needs from a recorded invocation. */
export type InvocationForVerification = {
  toolName: string;
  authorized: boolean;
  /** The tool's actual returned payload, retained in-memory for this turn only. */
  data?: unknown;
};

/**
 * Does `value` appear anywhere in `data`?
 *
 * Deliberately a containment check, not an equality check on a path: the model
 * cites a value, not a JSON pointer, and requiring it to produce an exact path
 * would fail on correct answers. Containment answers the question that actually
 * matters — "could this number have come from this result?" — and catches the
 * failure that matters, a value that appears nowhere in the data at all.
 */
export function valueAppearsIn(data: unknown, value: unknown): boolean {
  if (value === undefined || value === null) return true; // nothing asserted
  const target = String(value).trim().toLowerCase();
  if (target === "") return true;

  let found = false;
  const walk = (node: unknown): void => {
    if (found || node === null || node === undefined) return;
    if (typeof node === "object") {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
      } else {
        for (const v of Object.values(node as Record<string, unknown>)) walk(v);
      }
      return;
    }
    if (String(node).trim().toLowerCase() === target) found = true;
  };
  walk(data);
  return found;
}

/**
 * Verify claims against the turn's tool invocations.
 *
 * DOWNGRADES rather than deletes: a claim that fails verification becomes
 * `inference` with the issue recorded, instead of vanishing. Silently dropping a
 * sentence would leave an answer that reads as complete while missing the part
 * the model actually wanted to say — worse than showing it, correctly labelled
 * as unverified.
 *
 * Pure. No I/O.
 */
export function verifyClaims(
  claims: Claim[],
  invocations: InvocationForVerification[]
): VerifiedClaims {
  const issues: VerificationIssue[] = [];
  const out: Claim[] = [];

  claims.forEach((claim, index) => {
    const downgrade = (reason: VerificationIssue["reason"], detail: string): void => {
      issues.push({ claim_index: index, reason, detail });
      out.push({ ...claim, claim_class: "inference" });
    };

    if (claim.claim_class === "observed") {
      if (claim.citations.length === 0) {
        downgrade(
          "observed_without_citation",
          "An observed claim must cite the tool invocation it came from."
        );
        return;
      }

      let failed = false;
      for (const citation of claim.citations) {
        const inv = invocations[citation.invocation_index];
        if (!inv) {
          downgrade(
            "citation_out_of_range",
            `Citation references invocation ${citation.invocation_index}, which does not exist.`
          );
          failed = true;
          break;
        }
        if (!inv.authorized) {
          // Citing a DENIED read is the most dangerous failure available: the
          // model would be asserting a fact sourced from data it was refused.
          downgrade(
            "cited_tool_was_denied",
            `Cites ${inv.toolName}, which was denied for this user.`
          );
          failed = true;
          break;
        }
        if (citation.value !== undefined && !valueAppearsIn(inv.data, citation.value)) {
          downgrade(
            "value_not_in_tool_output",
            `Asserted ${JSON.stringify(citation.value)} but it does not appear in ${inv.toolName}'s result.`
          );
          failed = true;
          break;
        }
      }
      if (failed) return;
      out.push(claim);
      return;
    }

    if (claim.claim_class === "inference") {
      if ((claim.derived_from?.length ?? 0) === 0 && claim.citations.length === 0) {
        // An inference grounded in nothing is a guess wearing a label.
        issues.push({
          claim_index: index,
          reason: "inference_without_basis",
          detail: "An inference must list the facts it reasoned from.",
        });
      }
      out.push(claim);
      return;
    }

    out.push(claim);
  });

  return { claims: out, issues, clean: issues.length === 0 };
}

/**
 * Render claims to the plain-text answer.
 *
 * Inference and recommendation are PREFIXED so the distinction survives into any
 * surface that only takes the string — email, a Brief excerpt, a voice reply.
 * A provenance model that only exists in a rich UI is not a provenance model.
 */
export function renderClaims(claims: Claim[]): string {
  return claims
    .map((c) => {
      const text = c.claim_class === "inference"
        ? `Assessment: ${c.text}`
        : c.claim_class === "recommendation"
          ? `Recommended: ${c.text}`
          : c.text;
      // Terminate the sentence if the model did not. Joining unpunctuated claims
      // with a space runs them together — "...a process gap Recommended: review
      // the intake workflow" — which is merely untidy in a rich UI and actively
      // confusing in the surfaces this rendering exists for: a spoken reply or a
      // plain-text email, where the prefix is the ONLY cue that the class
      // changed.
      return /[.!?:;]$/.test(text.trimEnd()) ? text : `${text}.`;
    })
    .join(" ");
}

/** Parse claim blocks from a model response, tolerating a plain-prose answer. */
export function parseClaims(raw: unknown): Claim[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Claim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : null;
    const cls = typeof o.claim_class === "string" ? o.claim_class : null;
    if (!text || !cls || !(CLAIM_CLASSES as readonly string[]).includes(cls)) return null;
    out.push({
      text,
      claim_class: cls as ClaimClass,
      citations: Array.isArray(o.citations) ? (o.citations as ClaimCitation[]) : [],
      ...(Array.isArray(o.derived_from) ? { derived_from: o.derived_from as number[] } : {}),
    });
  }
  return out;
}
