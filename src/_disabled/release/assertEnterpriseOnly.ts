const forbidden = ["mvp", "demo", "example", "test-only"];

for (const key of forbidden) {
  if (process.env[key.toUpperCase()]) {
    throw new Error(`Forbidden MVP flag detected: ${key}`);
  }
}
