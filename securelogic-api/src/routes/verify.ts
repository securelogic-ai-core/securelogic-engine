import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";
import { sha256, canonicalize } from "../utils/hash";

export async function verifyRoutes(app: FastifyInstance) {
  app.get("/verify/:hash", async (request, reply) => {
    const { hash } = request.params as { hash: string };

    const snapshot = await prisma.runSnapshot.findUnique({
      where: { snapshotHash: hash },
    });

    if (!snapshot) {
      return reply.code(404).send({
        valid: false,
        reason: "Snapshot not found",
      });
    }

    const materialToHash = canonicalize({
      payload: snapshot.snapshotJson,
      previousHash: snapshot.previousHash,
    });

    const recomputed = sha256(materialToHash);

    const valid = recomputed === snapshot.snapshotHash;

    return {
      valid,
      storedHash: snapshot.snapshotHash,
      recomputedHash: recomputed,
      previousHash: snapshot.previousHash,
      createdAt: snapshot.createdAt,
      engineVersion: snapshot.engineVersion,
    };
  });
}