import Fastify from "fastify";

import { tenantsRoutes } from "../routes/tenants.js";
import { assessmentsRoutes } from "../routes/assessments.js";
import { runsRoutes } from "../routes/runs.js";
import { findingsRoutes } from "../routes/findings.js";
import { riskRoutes } from "../routes/risk.js";
import { finalizeRoutes } from "../routes/finalize.js";
import { verifyRoutes } from "../routes/verify.js";

export function buildServer() {
  const app = Fastify({
    logger: true,
  });

  app.register(
    async function v1(app) {
      app.register(tenantsRoutes);
      app.register(assessmentsRoutes);
      app.register(runsRoutes);
      app.register(findingsRoutes);
      app.register(riskRoutes);
      app.register(finalizeRoutes);
      app.register(verifyRoutes);
    },
    { prefix: "/api/v1" }
  );

  return app;
}