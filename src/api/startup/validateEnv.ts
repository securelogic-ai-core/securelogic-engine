const REQUIRED_ENV = [
  "NODE_ENV",
  "SECURELOGIC_API_KEYS",
  "SECURELOGIC_ENTITLEMENTS",
  "REDIS_URL"
];

export function validateEnv(): void {
  /**
   * Tests should never hard-exit the process.
   * They run without full API env config.
   */
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const missing = REQUIRED_ENV.filter(
    (key) => !process.env[key] || process.env[key]?.trim() === ""
  );

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    for (const key of missing) {
      console.error(`   - ${key}`);
    }
    process.exit(1); // FAIL CLOSED
  }

  if (process.env.NODE_ENV !== "production") {
    console.error(
      `❌ NODE_ENV must be "production" (got "${process.env.NODE_ENV}")`
    );
    process.exit(1); // FAIL CLOSED
  }
}