import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.ts";

export async function runsRoutes(app: FastifyInstance) {
  app.post("/runs", async (request) => {
    const body = request.body as {
      assessmentId: string;
      version: string;
    };

    const run = await prisma.run.create({
      data: {
        assessmentId: body.assessmentId,
        version: body.version,
      },
    });

    return run;
  });

  app.get("/runs", async () => {
    return prisma.run.findMany();
  });
}