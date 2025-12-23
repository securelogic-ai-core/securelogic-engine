/**
 * SecureLogic AI — Public Product API
 * ==================================
 * 
 * ⚠️ This file defines the ONLY supported import surface.
 * Anything not exported here is INTERNAL and NOT supported.
 * 
 * Breaking changes REQUIRE a new major version.
 */

// Primary product interfaces
export { SecureLogicAI } from "./SecureLogicAI";
export { SecureLogicVerifier } from "./SecureLogicVerifier";

// Core result surface (versioned)
export * from "./contracts/result";

// Commercial model
export * from "./contracts/entitlement";
export * from "./entitlement";

// Audit artifacts (read-only contracts)
export * from "./contracts/finding";
export * from "./contracts/risk";
export * from "./contracts/control";
export * from "./contracts/lineage";
export * from "./contracts/evidence";
export * from "./contracts/attestation";
export * from "./contracts/context";

// Integrity & verification
export * from "./contracts/integrity";
export * from "./validation";

// Backward compatibility
export * from "./migration";
