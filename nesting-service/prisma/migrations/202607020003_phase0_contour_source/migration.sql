CREATE TYPE "nesting"."ContourSource" AS ENUM ('EXACT_BOUNDARY', 'CONVEX_HULL', 'RECT_ESTIMATE');

ALTER TABLE "nesting"."Part"
  ADD COLUMN "contourSource" "nesting"."ContourSource" NOT NULL DEFAULT 'EXACT_BOUNDARY';
