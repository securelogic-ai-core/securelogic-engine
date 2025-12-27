export type WithPayloadHash = {
  payloadHash: string;
};

export function hasPayloadHash(
  envelope: unknown
): envelope is WithPayloadHash {
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    "payloadHash" in envelope &&
    typeof (envelope as Record<string, unknown>).payloadHash === "string"
  );
}
