import "dotenv/config";
import { buildServer } from "./server/app";

const app = buildServer();

const port = Number(process.env.PORT || 3000);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`🚀 API running on port ${port}`);
});