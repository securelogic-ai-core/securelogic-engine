import { prisma } from "../../lib/prisma";

async function run() {
  const total = await prisma.signal.count();
  const withSummary = await prisma.signal.count({
    where: { summary: { not: "" } },
  });

  console.log({
    totalSignals: total,
    signalsWithSummary: withSummary,
  });
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());