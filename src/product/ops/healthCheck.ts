export function healthCheck(): void {
  if (process.env.NODE_ENV !== "production") return;

  const required = ["NODE_ENV"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}
