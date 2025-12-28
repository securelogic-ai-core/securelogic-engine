export function assertProduction() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("PRODUCTION_ONLY_OPERATION");
  }
}
