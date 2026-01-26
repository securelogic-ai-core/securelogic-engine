import Fastify from "fastify";
import { runsRoutes } from "../routes/runs";
import { tenantsRoutes } from "../routes/tenants";
import { assessmentsRoutes } from "../routes/assessments";
import { findingsRoutes } from "../routes/findings";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(tenantsRoutes);
  app.register(assessmentsRoutes);
  app.register(runsRoutes);
  app.register(findingsRoutes);

  return app;
}
