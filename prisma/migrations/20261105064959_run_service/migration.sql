/*
  Warnings:

  - Added the required column `events` to the `Run` table without a default value. This is not possible if the table is not empty.
  - Added the required column `planPreview` to the `Run` table without a default value. This is not possible if the table is not empty.
  - Added the required column `results` to the `Run` table without a default value. This is not possible if the table is not empty.
  - Added the required column `version` to the `Run` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RunStatus" ADD VALUE 'planned';
ALTER TYPE "RunStatus" ADD VALUE 'blocked';

-- The Run table so far was a placeholder from the project foundation and never held
-- real data. Clear it so the new required columns can be added.
DELETE FROM "Run";

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "error" JSONB,
ADD COLUMN     "events" JSONB NOT NULL,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "plan" JSONB,
ADD COLUMN     "planPreview" JSONB NOT NULL,
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "results" JSONB NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "createdAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Step" (
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stepId" TEXT NOT NULL,
    "tool" TEXT,
    "state" TEXT NOT NULL,
    "decision" TEXT,
    "ruleId" TEXT,
    "decidedBy" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("runId","seq")
);

-- CreateTable
CREATE TABLE "ToolSetting" (
    "tool" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "template" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolSetting_pkey" PRIMARY KEY ("tool")
);

-- CreateTable
CREATE TABLE "TrustedDestination" (
    "destination" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedDestination_pkey" PRIMARY KEY ("destination")
);

-- CreateTable
CREATE TABLE "EvalReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scenarioSet" TEXT NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "EvalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Step_decision_idx" ON "Step"("decision");

-- CreateIndex
CREATE INDEX "Step_ruleId_idx" ON "Step"("ruleId");

-- CreateIndex
CREATE INDEX "Step_tool_idx" ON "Step"("tool");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
