import { startupBanner } from "./product/ops/startupBanner";
startupBanner();

import { assertRuntimeVersion } from "./product/versioning/assertRuntimeVersion";
assertRuntimeVersion(process.env.EXPECTED_RUNTIME_VERSION ?? "");

import "./product/ops/assertBuildIntegrity";
import { healthCheck } from "./product/ops/healthCheck";
healthCheck();
import "./product/release/assertEnterpriseOnly";
import "./runtime/assertProduction";
/**
 * SecureLogic AI – Public API
 * Only export what is safe for consumers.
 */

// Primary engine entry
export { SecureLogicAI } from "./product/SecureLogicAI";

// Report builders
export { ExecutiveRiskReportV2Builder } from "./report/builders/ExecutiveRiskReportV2Builder";

// Report contracts
export type { ExecutiveRiskReportV2 } from "./report/contracts/ExecutiveRiskReportV2";

// Core result types (read-only for consumers)
export type { EnterpriseRiskSummary } from "./engine/contracts/EnterpriseRiskSummary";
export type { RiskDecision } from "./engine/contracts/RiskDecision";
