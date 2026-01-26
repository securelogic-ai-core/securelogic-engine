import { buildServer } from "./server/app.js";

const app = buildServer();

const port = Number(process.env.PORT || 3000);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`API running on http://localhost:${port}`);
});