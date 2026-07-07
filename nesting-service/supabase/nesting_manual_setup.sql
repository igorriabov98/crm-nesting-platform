BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS nesting;

DO $$
BEGIN
  CREATE TYPE nesting."InactiveReason" AS ENUM ('HIDDEN_IN_CAD', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS nesting."NestingProject" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "orderNumber" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "strategy" TEXT NOT NULL DEFAULT 'minWaste',
  "status" TEXT NOT NULL DEFAULT 'created',
  "errorMessage" TEXT,
  "validationReport" JSONB,
  "createdBy" TEXT NOT NULL DEFAULT 'system',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stepFileUrl" TEXT,
  "pdfFileUrl" TEXT,
  "supersededByProjectId" TEXT
);

ALTER TABLE nesting."NestingProject"
  ADD COLUMN IF NOT EXISTS "supersededByProjectId" TEXT;

ALTER TABLE nesting."NestingProject"
  ADD COLUMN IF NOT EXISTS "validationReport" JSONB;

CREATE TABLE IF NOT EXISTS nesting."Part" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "thickness" DOUBLE PRECISION NOT NULL,
  "material" TEXT NOT NULL DEFAULT 'Сталь',
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "bboxSizeX" DOUBLE PRECISION,
  "bboxSizeY" DOUBLE PRECISION,
  "bboxSizeZ" DOUBLE PRECISION,
  "meshVolume" DOUBLE PRECISION,
  "meshArea" DOUBLE PRECISION,
  "facesCount" INTEGER,
  "contour" JSONB NOT NULL,
  "holes" JSONB,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "isSheetMetal" BOOLEAN NOT NULL DEFAULT TRUE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "inactiveReason" nesting."InactiveReason",
  "activityChangedBy" TEXT,
  "activityChangedAt" TIMESTAMP(3),
  "grainLock" BOOLEAN NOT NULL DEFAULT FALSE,
  "hasBends" BOOLEAN NOT NULL DEFAULT FALSE,
  "thumbnailSvg" TEXT,
  "classificationMethod" TEXT,
  "classificationWarning" TEXT,
  CONSTRAINT "Part_projectId_fkey"
    FOREIGN KEY ("projectId")
    REFERENCES nesting."NestingProject"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "classificationMethod" TEXT;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "classificationWarning" TEXT;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "bboxSizeX" DOUBLE PRECISION;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "bboxSizeY" DOUBLE PRECISION;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "bboxSizeZ" DOUBLE PRECISION;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "meshVolume" DOUBLE PRECISION;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "meshArea" DOUBLE PRECISION;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "facesCount" INTEGER;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "inactiveReason" nesting."InactiveReason";

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "activityChangedBy" TEXT;

ALTER TABLE nesting."Part"
  ADD COLUMN IF NOT EXISTS "activityChangedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS nesting."AISettings" (
  "id" TEXT PRIMARY KEY DEFAULT 'singleton',
  "apiKey" TEXT,
  "model" TEXT NOT NULL DEFAULT 'anthropic/claude-sonnet-4-6',
  "baseUrl" TEXT NOT NULL DEFAULT 'https://openrouter.ai/api/v1',
  "maxTokens" INTEGER NOT NULL DEFAULT 4000,
  "monthlyBudget" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE nesting."AISettings"
SET "model" = 'anthropic/claude-sonnet-4-6'
WHERE "id" = 'singleton'
  AND "model" = 'anthropic/claude-sonnet-4-20250514';

CREATE TABLE IF NOT EXISTS nesting."AIUsageLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "projectId" TEXT NOT NULL,
  "tokensUsed" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "cost" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nesting."NestingSheet" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "projectId" TEXT NOT NULL,
  "sheetRefId" TEXT,
  "remnantId" TEXT,
  "material" TEXT NOT NULL,
  "thickness" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "sheetIndex" INTEGER NOT NULL,
  "placements" JSONB NOT NULL,
  "utilization" DOUBLE PRECISION NOT NULL,
  "waste" DOUBLE PRECISION NOT NULL,
  "remnantGeom" JSONB,
  "dxfFileUrl" TEXT,
  CONSTRAINT "NestingSheet_projectId_fkey"
    FOREIGN KEY ("projectId")
    REFERENCES nesting."NestingProject"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS nesting."SheetCatalog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "material" TEXT NOT NULL,
  "thickness" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "price" DOUBLE PRECISION,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SheetCatalog_material_thickness_width_height_key"
    UNIQUE ("material", "thickness", "width", "height")
);

CREATE TABLE IF NOT EXISTS nesting."GapTable" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "material" TEXT NOT NULL,
  "thicknessMin" DOUBLE PRECISION NOT NULL,
  "thicknessMax" DOUBLE PRECISION NOT NULL,
  "gap" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "GapTable_material_thicknessMin_thicknessMax_key"
    UNIQUE ("material", "thicknessMin", "thicknessMax"),
  CONSTRAINT "GapTable_thickness_range_check"
    CHECK ("thicknessMin" <= "thicknessMax")
);

CREATE TABLE IF NOT EXISTS nesting."KFactor" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "material" TEXT NOT NULL,
  "thicknessMin" DOUBLE PRECISION NOT NULL,
  "thicknessMax" DOUBLE PRECISION NOT NULL,
  "kFactor" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "KFactor_material_thicknessMin_thicknessMax_key"
    UNIQUE ("material", "thicknessMin", "thicknessMax"),
  CONSTRAINT "KFactor_thickness_range_check"
    CHECK ("thicknessMin" <= "thicknessMax"),
  CONSTRAINT "KFactor_value_check"
    CHECK ("kFactor" > 0 AND "kFactor" <= 1)
);

CREATE TABLE IF NOT EXISTS nesting."Remnant" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "material" TEXT NOT NULL,
  "thickness" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "contour" JSONB,
  "sourceOrder" TEXT,
  "sourceSheet" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  "usedInOrder" TEXT,
  "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE OR REPLACE FUNCTION nesting.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "NestingProject_set_updated_at" ON nesting."NestingProject";
CREATE TRIGGER "NestingProject_set_updated_at"
BEFORE UPDATE ON nesting."NestingProject"
FOR EACH ROW
EXECUTE FUNCTION nesting.set_updated_at();

DROP TRIGGER IF EXISTS "AISettings_set_updated_at" ON nesting."AISettings";
CREATE TRIGGER "AISettings_set_updated_at"
BEFORE UPDATE ON nesting."AISettings"
FOR EACH ROW
EXECUTE FUNCTION nesting.set_updated_at();

CREATE INDEX IF NOT EXISTS "NestingProject_orderNumber_idx"
  ON nesting."NestingProject"("orderNumber");
CREATE INDEX IF NOT EXISTS "NestingProject_status_idx"
  ON nesting."NestingProject"("status");
CREATE INDEX IF NOT EXISTS "NestingProject_createdAt_idx"
  ON nesting."NestingProject"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Part_projectId_idx"
  ON nesting."Part"("projectId");
CREATE INDEX IF NOT EXISTS "Part_material_thickness_idx"
  ON nesting."Part"("material", "thickness");
CREATE INDEX IF NOT EXISTS "Part_isActive_idx"
  ON nesting."Part"("isActive");

CREATE INDEX IF NOT EXISTS "AIUsageLog_projectId_idx"
  ON nesting."AIUsageLog"("projectId");
CREATE INDEX IF NOT EXISTS "AIUsageLog_createdAt_idx"
  ON nesting."AIUsageLog"("createdAt");

CREATE INDEX IF NOT EXISTS "NestingSheet_projectId_idx"
  ON nesting."NestingSheet"("projectId");

CREATE INDEX IF NOT EXISTS "SheetCatalog_material_thickness_idx"
  ON nesting."SheetCatalog"("material", "thickness");
CREATE INDEX IF NOT EXISTS "SheetCatalog_isActive_idx"
  ON nesting."SheetCatalog"("isActive");

CREATE INDEX IF NOT EXISTS "GapTable_material_idx"
  ON nesting."GapTable"("material");

CREATE INDEX IF NOT EXISTS "KFactor_material_idx"
  ON nesting."KFactor"("material");

CREATE INDEX IF NOT EXISTS "Remnant_material_thickness_idx"
  ON nesting."Remnant"("material", "thickness");
CREATE INDEX IF NOT EXISTS "Remnant_isAvailable_idx"
  ON nesting."Remnant"("isAvailable");

WITH
  materials("material") AS (
    VALUES ('Сталь'), ('Нержавейка'), ('Алюминий')
  ),
  thicknesses("thickness") AS (
    VALUES
      (1::DOUBLE PRECISION),
      (1.5::DOUBLE PRECISION),
      (2::DOUBLE PRECISION),
      (3::DOUBLE PRECISION),
      (4::DOUBLE PRECISION),
      (5::DOUBLE PRECISION),
      (6::DOUBLE PRECISION),
      (8::DOUBLE PRECISION),
      (10::DOUBLE PRECISION),
      (12::DOUBLE PRECISION)
  ),
  sizes("width", "height") AS (
    VALUES
      (2500::DOUBLE PRECISION, 1250::DOUBLE PRECISION),
      (3000::DOUBLE PRECISION, 1500::DOUBLE PRECISION),
      (6000::DOUBLE PRECISION, 1500::DOUBLE PRECISION),
      (6000::DOUBLE PRECISION, 2000::DOUBLE PRECISION)
  ),
  rows AS (
    SELECT
      materials."material",
      thicknesses."thickness",
      sizes."width",
      sizes."height"
    FROM materials
    CROSS JOIN thicknesses
    CROSS JOIN sizes
  )
INSERT INTO nesting."SheetCatalog" (
  "id",
  "material",
  "thickness",
  "width",
  "height",
  "price",
  "stock",
  "isActive"
)
SELECT
  'sheet_' || substr(md5("material" || ':' || "thickness"::TEXT || ':' || "width"::TEXT || ':' || "height"::TEXT), 1, 24),
  "material",
  "thickness",
  "width",
  "height",
  NULL,
  10,
  TRUE
FROM rows
ON CONFLICT ("material", "thickness", "width", "height")
DO UPDATE SET
  "stock" = EXCLUDED."stock",
  "isActive" = TRUE;

WITH rows("material", "thicknessMin", "thicknessMax", "gap") AS (
  VALUES
    ('Сталь', 1::DOUBLE PRECISION, 1::DOUBLE PRECISION, 3::DOUBLE PRECISION),
    ('Сталь', 1.01::DOUBLE PRECISION, 2::DOUBLE PRECISION, 4::DOUBLE PRECISION),
    ('Сталь', 2.01::DOUBLE PRECISION, 5::DOUBLE PRECISION, 5::DOUBLE PRECISION),
    ('Сталь', 5.01::DOUBLE PRECISION, 10::DOUBLE PRECISION, 7::DOUBLE PRECISION),
    ('Сталь', 10.01::DOUBLE PRECISION, 20::DOUBLE PRECISION, 10::DOUBLE PRECISION),
    ('Нержавейка', 1::DOUBLE PRECISION, 1::DOUBLE PRECISION, 3.5::DOUBLE PRECISION),
    ('Нержавейка', 1.01::DOUBLE PRECISION, 2::DOUBLE PRECISION, 4.5::DOUBLE PRECISION),
    ('Нержавейка', 2.01::DOUBLE PRECISION, 5::DOUBLE PRECISION, 6::DOUBLE PRECISION),
    ('Нержавейка', 5.01::DOUBLE PRECISION, 10::DOUBLE PRECISION, 8::DOUBLE PRECISION),
    ('Алюминий', 1::DOUBLE PRECISION, 1::DOUBLE PRECISION, 3::DOUBLE PRECISION),
    ('Алюминий', 1.01::DOUBLE PRECISION, 3::DOUBLE PRECISION, 4::DOUBLE PRECISION),
    ('Алюминий', 3.01::DOUBLE PRECISION, 6::DOUBLE PRECISION, 5::DOUBLE PRECISION)
)
INSERT INTO nesting."GapTable" (
  "id",
  "material",
  "thicknessMin",
  "thicknessMax",
  "gap"
)
SELECT
  'gap_' || substr(md5("material" || ':' || "thicknessMin"::TEXT || ':' || "thicknessMax"::TEXT), 1, 24),
  "material",
  "thicknessMin",
  "thicknessMax",
  "gap"
FROM rows
ON CONFLICT ("material", "thicknessMin", "thicknessMax")
DO UPDATE SET
  "gap" = EXCLUDED."gap";

WITH rows("material", "thicknessMin", "thicknessMax", "kFactor") AS (
  VALUES
    ('Сталь', 1::DOUBLE PRECISION, 2::DOUBLE PRECISION, 0.35::DOUBLE PRECISION),
    ('Сталь', 2.01::DOUBLE PRECISION, 5::DOUBLE PRECISION, 0.4::DOUBLE PRECISION),
    ('Сталь', 5.01::DOUBLE PRECISION, 20::DOUBLE PRECISION, 0.45::DOUBLE PRECISION),
    ('Нержавейка', 1::DOUBLE PRECISION, 2::DOUBLE PRECISION, 0.35::DOUBLE PRECISION),
    ('Нержавейка', 2.01::DOUBLE PRECISION, 5::DOUBLE PRECISION, 0.38::DOUBLE PRECISION),
    ('Нержавейка', 5.01::DOUBLE PRECISION, 10::DOUBLE PRECISION, 0.42::DOUBLE PRECISION),
    ('Алюминий', 1::DOUBLE PRECISION, 3::DOUBLE PRECISION, 0.33::DOUBLE PRECISION),
    ('Алюминий', 3.01::DOUBLE PRECISION, 6::DOUBLE PRECISION, 0.38::DOUBLE PRECISION)
)
INSERT INTO nesting."KFactor" (
  "id",
  "material",
  "thicknessMin",
  "thicknessMax",
  "kFactor"
)
SELECT
  'kfactor_' || substr(md5("material" || ':' || "thicknessMin"::TEXT || ':' || "thicknessMax"::TEXT), 1, 24),
  "material",
  "thicknessMin",
  "thicknessMax",
  "kFactor"
FROM rows
ON CONFLICT ("material", "thicknessMin", "thicknessMax")
DO UPDATE SET
  "kFactor" = EXCLUDED."kFactor";

COMMIT;
