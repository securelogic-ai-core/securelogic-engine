import { buildApp } from "./server/app.js";

const app = buildApp();

const port = 3000;

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`🚀 SecureLogic API listening on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}