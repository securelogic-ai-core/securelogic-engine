export interface DeprecationPolicy {
  version: string;
  deprecatedAt?: string;
  sunsetAt?: string;
  reason?: string;
}
