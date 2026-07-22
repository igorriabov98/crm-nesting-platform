ALTER TABLE "nesting"."NestingProject"
  ADD COLUMN "aiRecalcRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiAnalysisRunId" TEXT,
  ADD COLUMN "aiAnalysisStartedAt" TIMESTAMP(3);

CREATE INDEX "NestingProject_aiAnalysisRunId_idx"
  ON "nesting"."NestingProject"("aiAnalysisRunId");
