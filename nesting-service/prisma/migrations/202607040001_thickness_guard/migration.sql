ALTER TABLE "nesting"."Part"
  ADD COLUMN "thicknessMismatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "thicknessMismatchNote" TEXT;
