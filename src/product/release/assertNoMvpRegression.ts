import { RELEASE_STATUS } from "./ReleaseFreeze";

export function assertNoMvpRegression(): void {
  if (RELEASE_STATUS !== "GA_ENTERPRISE_LOCKED") {
    throw new Error("RELEASE_NOT_ENTERPRISE_GA");
  }
}
