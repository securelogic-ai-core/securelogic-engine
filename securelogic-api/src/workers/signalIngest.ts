import { prisma } from "../lib/prisma";
import { createHash } from "crypto";
import { ingestCisaKev } from "./sources/cisaKev";

function hashSignal(input: {
  source: string;
  title: string;
  publishedAt: Date;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        source: input.source,
        title: input.title,
        publishedAt: input.publishedAt.toISOString(),
      })
    )
    .digest("hex");
}

async function ingest() {
  console.log("🔎 Starting signal ingestion");

  const signals = await ingestCisaKev();
  let ingested = 0;

  for (const signal of signals) {
    const hash = hashSignal({
      source: signal.source,
      title: signal.title,
      publishedAt: signal.publishedAt,
    });

    /**
     * 🔒 RAW vs DERIVED FIELD GUARD
     * Ingestion is NEVER allowed to overwrite derived/enriched fields
     */
    const updatePayload = {
      title: signal.title,
      url: signal.url,
      category: signal.category,
      publishedAt: signal.publishedAt,
      rawPayload: signal.rawPayload,
    };

    const forbiddenFields = [
      "summary",
      "executiveSummary",
      "severityHint",
      "relevanceScore",
      "topic",
    ];

    for (const field of forbiddenFields) {
      if (field in updatePayload) {
        throw new Error(
          `❌ Ingest attempted to overwrite derived field "${field}". This is forbidden.`
        );
      }
    }

    await prisma.signal.upsert({
      where: { hash },

      // 🔒 UPDATE: RAW FIELDS ONLY
      update: updatePayload,

      // 🆕 CREATE: initialize derived fields ONCE
      create: {
        hash,
        source: signal.source,
        title: signal.title,
        url: signal.url,
        category: signal.category,
        publishedAt: signal.publishedAt,
        rawPayload: signal.rawPayload,

        // Placeholder summary only on first insert
        summary: signal.title,
      },
    });

    ingested++;
  }

  console.log(`✅ Ingested ${ingested} signals`);
}

ingest()
  .catch((err) => {
    console.error("❌ Signal ingest failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });