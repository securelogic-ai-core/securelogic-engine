import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma";

const CreateAssessmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  framework: z.string().min(1, "Framework is required"),
  tenantId: z.string().uuid("tenantId must be a UUID"),
});

export async function assessmentsRoutes(app: FastifyInstance) {
  app.post("/assessments", async (request, reply) => {
    const parse = CreateAssessmentSchema.safeParse(request.body);

    if (!parse.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        issues: parse.error.format(),
      });
    }

    const { name, framework, tenantId } = parse.data;

    // Ensure tenant exists (no blind FK errors)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        error: "Tenant not found",
      });
    }

    const assessment = await prisma.assessment.create({
      data: {
        name,
        framework,
        tenantId,
      },
    });

    return assessment;
  });

  app.get("/assessments", async () => {
    return prisma.assessment.findMany();
  });
}