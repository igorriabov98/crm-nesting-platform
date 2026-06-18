-- Persistent nesting files live in private Supabase Storage. Railway has no volume.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('nesting-files', 'nesting-files', false, 524288000)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE IF EXISTS nesting."NestingProject"
  ADD COLUMN IF NOT EXISTS "stepStorageUri" TEXT,
  ADD COLUMN IF NOT EXISTS "pdfStorageUri" TEXT;

ALTER TABLE IF EXISTS nesting."ProjectInput"
  ALTER COLUMN "stepFileUrl" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "stepStorageUri" TEXT,
  ADD COLUMN IF NOT EXISTS "pdfStorageUri" TEXT;

ALTER TABLE IF EXISTS nesting."NestingSheet"
  ADD COLUMN IF NOT EXISTS "dxfStorageUri" TEXT;
