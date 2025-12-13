export function assertSingleEngineRuntime() {
  if (process.env.NODE_ENV === "production") {
    try {
      require("../engines/v2");
      throw new Error("Legacy engine detected in production build");
    } catch {
      // OK: legacy engine not present
    }
  }
}
