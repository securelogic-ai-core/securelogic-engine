import type { ProcurementResultV1 } from "../contracts/ProcurementResultV1";

export type ProcurementExecutionResult =
  | { status: "PROCURED"; result: ProcurementResultV1 }
  | { status: "UNSUPPORTED_SERVICE" };
