import { RUNTIME_VERSION } from "../versioning/RuntimeVersion";

export function startupBanner(): void {
  console.info("[SecureLogic] ENTERPRISE MODE");
  console.info("[SecureLogic] Version:", RUNTIME_VERSION);
  console.info("[SecureLogic] Timestamp:", new Date().toISOString());
}
