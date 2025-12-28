import type { AttestationV1 } from "../contracts";

export function sortAttestations(
  attestations: AttestationV1[]
): AttestationV1[] {
  return [...attestations].sort((a, b) =>
    `${a.attester}:${a.issuedAt}`.localeCompare(
      `${b.attester}:${b.issuedAt}`
    )
  );
}
