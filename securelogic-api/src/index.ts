import "dotenv/config";
import { env } from "./config/env";
import { buildServer } from "./server/app";

const app = buildServer();

app.listen({ port: env.PORT, host: "0.0.0.0" }).then(() => {
  console.log(`🚀 API running on port ${env.PORT}`);
});