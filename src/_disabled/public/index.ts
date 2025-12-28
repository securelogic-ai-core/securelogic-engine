/**
 * SecureLogic AI — Public API Surface
 * ==================================
 * This file defines the ONLY supported import surface for customers.
 * Anything not exported here is INTERNAL and may change without notice.
 */

// Primary runtime APIs
export { SecureLogicAI } from "../SecureLogicAI";
export { SecureLogicVerifier } from "../SecureLogicVerifier";

// Stable result contracts
export type {
  AuditSprintResultV1
} from "../contracts/result/AuditSprintResultV1";

// Integrity verification
export type {
  ResultIntegrityV1
} from "../contracts/integrity/ResultIntegrity";

// Evidence references (read-only)
export type {
  EvidenceReferenceV1
} from "../contracts/evidence/EvidenceReference";
