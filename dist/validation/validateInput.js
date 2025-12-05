"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateInput = validateInput;
const ajv_1 = __importDefault(require("ajv"));
const input_schema_json_1 = __importDefault(require("../../schemas/input.schema.json"));
const ajv = new ajv_1.default({ allErrors: true });
function validateInput(input) {
    const validate = ajv.compile(input_schema_json_1.default);
    if (!validate(input)) {
        console.error("❌ INPUT VALIDATION FAILED:");
        console.error(validate.errors);
        throw new Error("Input failed schema validation.");
    }
    return true;
}
