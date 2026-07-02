ALTER TABLE "nesting"."Part"
  ADD COLUMN "dimensionMismatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mismatchNote" TEXT;
