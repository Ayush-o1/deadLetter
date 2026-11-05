-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('planning', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'interrupted');

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'planning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);
