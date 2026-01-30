-- CreateTable
CREATE TABLE "RunSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "engineVersion" TEXT NOT NULL,

    CONSTRAINT "RunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunSnapshot_runId_key" ON "RunSnapshot"("runId");

-- CreateIndex
CREATE INDEX "RunSnapshot_createdAt_idx" ON "RunSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- AddForeignKey
ALTER TABLE "RunSnapshot" ADD CONSTRAINT "RunSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
