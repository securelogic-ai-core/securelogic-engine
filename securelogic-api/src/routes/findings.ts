import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

export async function findingsRoutes(app: FastifyInstance) {
  app.post("/findings", async (request, reply) => {
    const body = request.body as {
      id: string;
      title: string;
      severity: "Low" | "Medium" | "High" | "Critical";
      confidence: number;
      domain: string;
      framework: string;
      evidence?: string;
      runId: string;
    };

    const run = await prisma.run.findUnique({
      where: { id: body.runId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }

    // 🔒 HARD IMMUTABILITY
    if (run.status === "FINALIZED") {
      return reply.code(409).send({
        error: "Run is finalized. Findings are immutable.",
      });
    }

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
        riskScore: 0,
        riskBand: "UNSCORED",
      },
    });

    return finding;
  });

  app.get("/findings", async () => {
    return prisma.finding.findMany();
  });
}