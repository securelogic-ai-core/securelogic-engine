import type { ProcurementRequestV1 } from "../contracts/ProcurementRequestV1";
import type { ProcurementResultV1 } from "../contracts/ProcurementResultV1";

export interface ProcurementProvider {
  supports(serviceCode: string): boolean;
  procure(request: ProcurementRequestV1): ProcurementResultV1;
}
