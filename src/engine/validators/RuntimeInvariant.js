"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSingleEngineRuntime = assertSingleEngineRuntime;
function assertSingleEngineRuntime() {
    if (process.env.NODE_ENV === "production") {
        try {
            require("../engines/v2");
            throw new Error("Legacy engine detected in production build");
        }
        catch (_a) {
            // OK: legacy engine not present
        }
    }
}
