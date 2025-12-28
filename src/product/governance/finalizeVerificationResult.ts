import { deepFreeze } from "../integrity/deepFreeze";

export function finalizeVerificationResult<T>(result: T): Readonly<T> {
  return deepFreeze(result);
}
