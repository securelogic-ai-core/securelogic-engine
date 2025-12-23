"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateInput = validateInput;
var ajv_1 = require("ajv");
var input_schema_json_1 = require("../../schemas/input.schema.json");
var ajv = new ajv_1.default({ allErrors: true });
function validateInput(input) {
    var validate = ajv.compile(input_schema_json_1.default);
    if (!validate(input)) {
        console.error("❌ INPUT VALIDATION FAILED:");
        console.error(validate.errors);
        throw new Error("Input failed schema validation.");
    }
    return true;
}
