ALTER TABLE "nesting"."Part"
  ADD COLUMN "aiApplySnapshot" JSONB;

ALTER TABLE "nesting"."AISettings"
  ADD COLUMN "autoApplyResults" BOOLEAN NOT NULL DEFAULT true;
