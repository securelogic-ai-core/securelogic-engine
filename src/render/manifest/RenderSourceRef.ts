export type RenderSourceType =
  | "AUDIT_RESULT"
  | "OPINION"
  | "POLICY_SET"
  | "DASHBOARD_MODEL";

export interface RenderSourceRef {
  type: RenderSourceType;
  sourceId: string;
  version: string;
}
