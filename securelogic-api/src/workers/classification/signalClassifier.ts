import { prisma } from "../../lib/prisma";

function classifySignal(title: string, summary: string | null): string {
  const text = `${title} ${summary ?? ""}`.toLowerCase();

  if (
    text.includes("ai") ||
    text.includes("model") ||
    text.includes("algorithm")
  ) {
    return "AI";
  }

  if (
    text.includes("sec") ||
    text.includes("doj") ||
    text.includes("regulation") ||
    text.includes("compliance")
  ) {
    return "Regulatory";
  }

  if (
    text.includes("cve") ||
    text.includes("vulnerability") ||
    text.includes("exploit")
  ) {
    return "Vulnerability";
  }

  if (
    text.includes("breach") ||
    text.includes("leak") ||
    text.includes("compromised")
  ) {
    return "Breach";
  }

  return "General";
}

async function classifySignals() {
  console.log("🏷️ Starting signal classification");

  // ONLY pull signals that have not been classified yet
  const signals = await prisma.signal.findMany({
    where: {
      topic: null,
    },
    take: 200,
    orderBy: { publishedAt: "desc" },
  });

  let classified = 0;

  for (const signal of signals) {
    const topic = classifySignal(signal.title, signal.summary);

    await prisma.signal.update({
      where: { id: signal.id },
      data: {
        topic,
      },
    });

    classified++;
  }

  console.log(`✅ Classified ${classified} signals`);
}

classifySignals()
  .catch((err) => {
    console.error("❌ Signal classification failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });