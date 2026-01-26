import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      name: "Acme Health",
      slug: "acme-health",
    },
  });

  const assessment = await prisma.assessment.create({
    data: {
      name: "SOC 2 Type II",
      framework: "SOC2",
      tenantId: tenant.id,
    },
  });

  const run = await prisma.run.create({
    data: {
      version: "v1",
      assessmentId: assessment.id,
    },
  });

  const finding = await prisma.finding.create({
    data: {
      id: "F-001",
      title: "MFA not enforced",
      severity: "High",
      confidence: 90,
      domain: "Access Control",
      framework: "SOC2",
      runId: run.id,
    },
  });

  console.log("Inserted:");
  console.log({ tenant, assessment, run, finding });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
