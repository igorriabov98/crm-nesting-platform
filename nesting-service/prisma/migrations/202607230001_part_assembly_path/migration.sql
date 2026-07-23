ALTER TABLE "nesting"."Part"
  ADD COLUMN "assemblyPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
