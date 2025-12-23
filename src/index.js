"use strict";
/**
 * SecureLogic AI – Public API
 * Only export what is safe for consumers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveRiskReportV2Builder = exports.SecureLogicAI = void 0;
// Primary engine entry
var SecureLogicAI_1 = require("./product/SecureLogicAI");
Object.defineProperty(exports, "SecureLogicAI", { enumerable: true, get: function () { return SecureLogicAI_1.SecureLogicAI; } });
// Report builders
var ExecutiveRiskReportV2Builder_1 = require("./report/builders/ExecutiveRiskReportV2Builder");
Object.defineProperty(exports, "ExecutiveRiskReportV2Builder", { enumerable: true, get: function () { return ExecutiveRiskReportV2Builder_1.ExecutiveRiskReportV2Builder; } });
