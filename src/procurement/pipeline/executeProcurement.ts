import { ProcurementRegistry } from "../providers/ProcurementRegistry";
import type { ProcurementRequestV1 } from "../contracts/ProcurementRequestV1";
import type { ProcurementExecutionResult } from "./ProcurementExecutionResult";

export function executeProcurement(
  request: ProcurementRequestV1
): ProcurementExecutionResult {
  const provider = ProcurementRegistry.resolve(request.serviceCode);

  if (!provider) {
    return { status: "UNSUPPORTED_SERVICE" };
  }

  const result = provider.procure(request);
  return { status: "PROCURED", result };
}
