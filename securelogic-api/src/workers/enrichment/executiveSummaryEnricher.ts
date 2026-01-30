import { prisma } from "../../lib/prisma";

async function enrichExecutiveSummaries() {
  console.log("🧠 Starting executive summary enrichment");

  const signals = await prisma.signal.findMany({
    where: {
      executiveSummary: null,
    },
    take: 50,
    orderBy: { publishedAt: "desc" },
  });

  let enriched = 0;

  for (const signal of signals) {
    const executiveSummary = `This signal highlights a ${signal.category.toLowerCase()} development from ${signal.source} that may require executive awareness.`;

    await prisma.signal.update({
      where: { id: signal.id },
      data: {
        executiveSummary,
      },
    });

    enriched++;
  }

  console.log(`✅ Enriched ${enriched} executive summaries`);
}

enrichExecutiveSummaries()
  .catch((err) => {
    console.error("❌ Executive enrichment failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });