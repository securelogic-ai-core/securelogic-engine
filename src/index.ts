

import "./product/ops/assertBuildIntegrity";
import "./product/release/assertEnterpriseOnly";
import "./runtime/assertProduction";
/**
 * SecureLogic AI – Public API
 * Only export what is safe for consumers.
 */

// Primary engine entry

// Report builders
export { ExecutiveRiskReportV2Builder } from "./report/builders/ExecutiveRiskReportV2Builder.js";

// Report contracts
export type { ExecutiveRiskReportV2 } from "./report/contracts/ExecutiveRiskReportV2.js";

// Core result types (read-only for consumers)
export type { EnterpriseRiskSummary } from "./engine/contracts/EnterpriseRiskSummary.js";
export type { RiskDecision } from "./engine/contracts/RiskDecision.js";
