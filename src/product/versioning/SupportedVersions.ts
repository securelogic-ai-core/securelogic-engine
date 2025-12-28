export const SUPPORTED_ENVELOPE_VERSIONS = ["result-envelope-v1"] as const;
export type SupportedEnvelopeVersion =
  typeof SUPPORTED_ENVELOPE_VERSIONS[number];
