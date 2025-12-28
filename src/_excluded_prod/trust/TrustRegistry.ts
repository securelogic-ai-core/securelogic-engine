import type { TrustLevelV1 } from "./TrustLevelV1";
import { deepFreeze } from "../integrity/deepFreeze";

const trustLevels = new Map<string, TrustLevelV1>();

export function registerTrustLevel(level: TrustLevelV1): void {
  trustLevels.set(level.subjectId, deepFreeze(level));
}

export function getTrustLevel(subjectId: string): TrustLevelV1 | undefined {
  return trustLevels.get(subjectId);
}
