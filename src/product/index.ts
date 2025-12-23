// ─────────────────────────────────────────────
// Primary Product Interfaces (ONLY entry points)
// ─────────────────────────────────────────────
export { SecureLogicAI } from "./SecureLogicAI";
export { SecureLogicVerifier } from "./SecureLogicVerifier";

// ─────────────────────────────────────────────
// Core Client-Facing Result Surface
// ─────────────────────────────────────────────
export * from "./contracts/result";

// ─────────────────────────────────────────────
// Audit Artifacts (Deterministic & Traceable)
// ─────────────────────────────────────────────
export * from "./contracts/finding";
export * from "./contracts/risk";
export * from "./contracts/control";
export * from "./contracts/lineage";
export * from "./contracts/evidence";
export * from "./contracts/attestation";
export * from "./contracts/context";

// ─────────────────────────────────────────────
// Integrity & Validation (Read-only)
// ─────────────────────────────────────────────
export * from "./contracts/integrity";
export * from "./validation";

// ─────────────────────────────────────────────
// Backward Compatibility & Replay
// ─────────────────────────────────────────────
export * from "./migration";