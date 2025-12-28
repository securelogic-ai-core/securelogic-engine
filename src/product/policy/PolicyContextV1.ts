export interface PolicyContextV1 {
  tenantId: string;
  actorId: string;
  roles: string[];
  attributes: Record<string, string | number | boolean>;
}
