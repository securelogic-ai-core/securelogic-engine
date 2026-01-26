import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

export async function tenantsRoutes(app: FastifyInstance) {
  app.post("/tenants", async (request) => {
    const body = request.body as { name: string; slug: string };

    const tenant = await prisma.tenant.create({
      data: {
        name: body.name,
        slug: body.slug,
      },
    });

    return tenant;
  });

  app.get("/tenants", async () => {
    return prisma.tenant.findMany();
  });
}
