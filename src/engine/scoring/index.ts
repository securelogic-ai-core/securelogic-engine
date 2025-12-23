/**
 * SecureLogic Engine — Scoring Module
 * ----------------------------------
 * ENTERPRISE PUBLIC SURFACE
 *
 * Internal files MUST NOT be imported outside this folder.
 * This is a monetizable boundary.
 */

import type { ScoringOutputV1 } from "../contracts";

// Public API
export { runScoring } from "./runScoring";

// Re-export contract ONLY (not implementations)
export type { ScoringOutputV1 };
