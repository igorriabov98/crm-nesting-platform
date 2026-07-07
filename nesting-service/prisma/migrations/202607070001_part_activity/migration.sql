CREATE TYPE "nesting"."InactiveReason" AS ENUM ('HIDDEN_IN_CAD', 'MANUAL');

ALTER TABLE "nesting"."Part"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inactiveReason" "nesting"."InactiveReason",
  ADD COLUMN "activityChangedBy" TEXT,
  ADD COLUMN "activityChangedAt" TIMESTAMP(3);

CREATE INDEX "Part_isActive_idx" ON "nesting"."Part"("isActive");
