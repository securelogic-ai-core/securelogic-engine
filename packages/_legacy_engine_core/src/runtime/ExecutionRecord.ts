export interface ExecutionRecord {
  payload: Record<string, unknown>;
  payloadHash: string;
  policyBundleHash: string;
  signatures: string[];
  previousHash?: string;
}
