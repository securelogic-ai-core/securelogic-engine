export function assertNoPlaintext(secret: unknown): void {
  if (typeof secret === "string") {
    throw new Error("PLAINTEXT_SECRET_DETECTED");
  }
}
