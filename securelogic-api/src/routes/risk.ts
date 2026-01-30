import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";
import { RiskScoringEngine } from "../engine/risk/RiskScoringEngine";

export async function riskRoutes(app: FastifyInstance) {
  app.get("/runs/:id/risk", async (request) => {
    const { id } = request.params as { id: string };

    // 1. Check for cached snapshot
    const existing = await prisma.riskSnapshot.findUnique({
      where: { runId: id },
    });

    if (existing) {
      return {
        runId: id,
        ...existing.payload,
        cached: true,
      };
    }

    // 2. Load findings
    const findings = await prisma.finding.findMany({
      where: { runId: id },
    });

    // 3. Build engine input
    const inputs = findings.map((f) => ({
      id: f.id,
      severity: f.severity as any,
      confidence: f.confidence,
      domain: f.domain,
    }));

    // 4. Run engine
    const result = RiskScoringEngine.score(inputs);

    // 5. Persist snapshot
    await prisma.riskSnapshot.create({
      data: {
        runId: id,
        payload: result as any,
      },
    });

    // 6. Return result
    return {
      runId: id,
      ...result,
      cached: false,
    };
  });
}