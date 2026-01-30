import { prisma } from "../../lib/prisma";

async function run() {
  const backlog = await prisma.signal.count({
    where: {
      executiveSummary: null,
    },
  });

  console.log({ executiveSummaryBacklog: backlog });
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });