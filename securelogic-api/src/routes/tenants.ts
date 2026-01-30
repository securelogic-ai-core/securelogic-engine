import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma";

// Zod schema
const CreateTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

export async function tenantsRoutes(app: FastifyInstance) {
  app.post("/tenants", async (request, reply) => {
    const parse = CreateTenantSchema.safeParse(request.body);

    if (!parse.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        issues: parse.error.format(),
      });
    }

    const { name, slug } = parse.data;

    const tenant = await prisma.tenant.create({
      data: { name, slug },
    });

    return tenant;
  });

  app.get("/tenants", async () => {
    return prisma.tenant.findMany();
  });
}