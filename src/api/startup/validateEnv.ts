const REQUIRED_ENV = [
  "SECURELOGIC_API_KEYS",
  "SECURELOGIC_ENTITLEMENTS",
  "REDIS_URL"
];

export function validateEnv(): void {
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
}