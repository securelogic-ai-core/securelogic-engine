import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";
import { RiskScoringEngine } from "../engine/risk/RiskScoringEngine";
import { sha256, canonicalize } from "../utils/hash";

export async function finalizeRoutes(app: FastifyInstance) {
  app.post("/runs/:id/finalize", async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await prisma.run.findUnique({ where: { id } });

    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }

    // Already finalized → return cached snapshot
    if (run.status === "FINALIZED") {
      const snapshot = await prisma.runSnapshot.findUnique({
        where: { runId: id },
      });

      if (!snapshot) {
        return reply.code(500).send({
          error: "Run finalized but snapshot missing",
        });
      }

      return {
        runId: id,
        ...snapshot.snapshotJson,
        snapshotHash: snapshot.snapshotHash,
        previousHash: snapshot.previousHash,
        finalized: true,
        cached: true,
      };
    }

    // Load findings
    const findings = await prisma.finding.findMany({
      where: { runId: id },
    });

    const inputs = findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      confidence: f.confidence,
      domain: f.domain,
    }));

    const result = RiskScoringEngine.score(inputs);

    // Get previous snapshot (global chain)
    const previous = await prisma.runSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const previousHash = previous?.snapshotHash ?? null;

    const snapshotPayload = {
      runId: id,
      result,
      createdAt: new Date().toISOString(),
    };

    const materialToHash = canonicalize({
      payload: snapshotPayload,
      previousHash,
    });

    const snapshotHash = sha256(materialToHash);

    const snapshot = await prisma.$transaction(async (tx) => {
      const snap = await tx.runSnapshot.create({
        data: {
          runId: id,
          snapshotJson: snapshotPayload,
          snapshotHash,
          previousHash,
          engineVersion: "1.0.0",
        },
      });

      await tx.run.update({
        where: { id },
        data: { status: "FINALIZED" },
      });

      return snap;
    });

    return {
      runId: id,
      ...snapshot.snapshotJson,
      snapshotHash: snapshot.snapshotHash,
      previousHash: snapshot.previousHash,
      finalized: true,
      cached: false,
    };
  });
}
