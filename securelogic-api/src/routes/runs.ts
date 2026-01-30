import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const CreateRunSchema = z.object({
  assessmentId: z.string().uuid(),
  version: z.string().min(1),
});

export async function runsRoutes(app: FastifyInstance) {
  app.post("/runs", async (request, reply) => {
    const parsed = CreateRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body" });
    }

    const { assessmentId, version } = parsed.data;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      return reply.code(404).send({ error: "Assessment not found" });
    }

    const run = await prisma.run.create({
      data: { assessmentId, version },
    });

    return reply.code(201).send(run);
  });

  app.get("/runs", async () => {
    return prisma.run.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        findings: true,
        riskSnapshot: true,
        ledger: true,
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }

    return run;
  });
}
