/*
  Warnings:

  - A unique constraint covering the columns `[snapshotHash]` on the table `RunSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "RunSnapshot_snapshotHash_key" ON "RunSnapshot"("snapshotHash");
