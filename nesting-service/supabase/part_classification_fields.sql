ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "classificationMethod" TEXT;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "classificationWarning" TEXT;
