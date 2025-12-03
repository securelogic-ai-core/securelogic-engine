"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const RunnerEngine_1 = require("../engines/v2/RunnerEngine");
const sampleInput_json_1 = __importDefault(require("./sampleInput.json"));
async function main() {
    console.log("=== SecureLogic Engine Test Runner ===");
    const engine = RunnerEngine_1.RunnerEngine;
    const input = sampleInput_json_1.default;
    try {
        const result = RunnerEngine_1.RunnerEngine.execute(input);
        console.log("\n=== FINAL REPORT OUTPUT ===\n");
        console.log(JSON.stringify(result, null, 2));
        console.log("\n=== Engine Run Complete ===");
    }
    catch (err) {
        console.error("ENGINE FAILED:", err.message || err);
    }
}
main();
