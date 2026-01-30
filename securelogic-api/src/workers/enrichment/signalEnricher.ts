import { prisma } from "../../lib/prisma";

const BATCH_SIZE = 50;

async function enrichSignals() {
  console.log("🧠 Starting signal enrichment");

  // Find the oldest unenriched signals first
  const signals = await prisma.signal.findMany({
    where: {
      executiveSummary: null,
    },
    orderBy: {
      publishedAt: "asc",
    },
    take: BATCH_SIZE,
  });

  if (signals.length === 0) {
    console.log("✅ No signals left to enrich");
    return;
  }

  let enriched = 0;

  for (const signal of signals) {
    const executiveSummary =
      signal.title.length > 280
        ? signal.title.slice(0, 277) + "..."
        : signal.title;

    await prisma.signal.update({
      where: { id: signal.id },
      data: {
        executiveSummary,
      },
    });

    enriched++;
  }

  console.log(`✅ Enriched ${enriched} signals`);
}

enrichSignals()
  .catch((err) => {
    console.error("❌ Signal enrichment failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });