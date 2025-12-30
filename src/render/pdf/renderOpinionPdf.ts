import type { OpinionEnvelopeV1 } from "../../opinion/envelope/OpinionEnvelopeV1";

export function renderOpinionPdf(
  envelope: OpinionEnvelopeV1
): Buffer {
  const content = `
SECURELOGIC AI — FORMAL OPINION

Scope: ${envelope.payload.scope}
Verdict: ${envelope.payload.verdict}
Issued: ${envelope.payload.issuedAt}

This opinion is cryptographically sealed.
`;

  return Buffer.from(content);
}
