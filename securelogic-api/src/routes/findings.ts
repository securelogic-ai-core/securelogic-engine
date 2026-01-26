import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

export async function findingsRoutes(app: FastifyInstance) {
  app.post("/findings", async (request) => {
    const body = request.body as {
      id: string;
      title: string;
      severity: string;
      confidence: number;
      domain: string;
      framework: string;
      evidence?: string;
      runId: string;
    };

    const finding = await prisma.finding.create({
      data: {
        id: body.id,
        title: body.title,
        severity: body.severity,
        confidence: body.confidence,
        domain: body.domain,
        framework: body.framework,
        evidence: body.evidence,
        runId: body.runId,
      },
    });

    return finding;
  });

  app.get("/findings", async () => {
    return prisma.finding.findMany();
  });
}
