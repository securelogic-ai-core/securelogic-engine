/**
 * SecureLogic AI — Public Product Surface
 * ======================================
 * LOCKED, ENTERPRISE-GRADE EXPORT BOUNDARY
 *
 * Only symbols exported here are supported for external consumption.
 * Internal modules are NOT part of the public API.
 */

// Primary product entrypoint
export { SecureLogicAI } from "./SecureLogicAI";

// Verification & integrity (read-only)
export { SecureLogicVerifier } from "./SecureLogicVerifier";

// Client-facing result contract (versioned)
export type {
  AuditSprintResultV1
} from "./contracts/result";

// Licensing
export type {
  LicenseTier
} from "./contracts/LicenseTier";

export type {
  LicenseContext
} from "./contracts/LicenseContext";
