import type { TenantContextV1 } from "../tenancy/TenantContextV1";
import type { AuthContextV1 } from "../auth/AuthContextV1";

export interface RequestContextV1 {
  tenant: TenantContextV1;
  auth: AuthContextV1;
  requestId: string;
}
