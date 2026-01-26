import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

export async function assessmentsRoutes(app: FastifyInstance) {
  app.post("/assessments", async (request) => {
    const body = request.body as {
      name: string;
      framework: string;
      tenantId: string;
    };

    const assessment = await prisma.assessment.create({
      data: {
        name: body.name,
        framework: body.framework,
        tenantId: body.tenantId,
      },
    });

    return assessment;
  });

  app.get("/assessments", async () => {
    return prisma.assessment.findMany();
  });
}
