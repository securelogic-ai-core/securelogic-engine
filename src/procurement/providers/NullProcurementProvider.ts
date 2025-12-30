import type { ProcurementProvider } from "./ProcurementProvider";
import type { ProcurementRequestV1 } from "../contracts/ProcurementRequestV1";
import type { ProcurementResultV1 } from "../contracts/ProcurementResultV1";

export class NullProcurementProvider implements ProcurementProvider {
  supports(): boolean {
    return true;
  }

  procure(_: ProcurementRequestV1): ProcurementResultV1 {
    return {
      status: "REJECTED",
      submittedAt: new Date().toISOString()
    };
  }
}
