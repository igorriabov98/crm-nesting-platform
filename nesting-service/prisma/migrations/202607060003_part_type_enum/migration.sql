CREATE TYPE "nesting"."PartType" AS ENUM ('SHEET', 'PROFILE', 'PURCHASED');

ALTER TABLE "nesting"."Part"
  ADD COLUMN "partType" "nesting"."PartType" NOT NULL DEFAULT 'SHEET',
  ALTER COLUMN "thickness" DROP NOT NULL;

UPDATE "nesting"."Part"
SET "partType" = CASE
  WHEN "isSheetMetal" THEN 'SHEET'::"nesting"."PartType"
  ELSE 'PROFILE'::"nesting"."PartType"
END;

CREATE INDEX "Part_partType_idx" ON "nesting"."Part"("partType");
