--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: nesting; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA nesting;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AISettings; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."AISettings" (
    id text DEFAULT 'singleton'::text NOT NULL,
    "apiKey" text,
    model text DEFAULT 'anthropic/claude-sonnet-4-6'::text NOT NULL,
    "baseUrl" text DEFAULT 'https://openrouter.ai/api/v1'::text NOT NULL,
    "maxTokens" integer DEFAULT 4000 NOT NULL,
    "monthlyBudget" double precision DEFAULT 50 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AIUsageLog; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."AIUsageLog" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "tokensUsed" integer NOT NULL,
    model text NOT NULL,
    cost double precision NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: GapTable; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."GapTable" (
    id text NOT NULL,
    material text NOT NULL,
    "thicknessMin" double precision NOT NULL,
    "thicknessMax" double precision NOT NULL,
    gap double precision NOT NULL
);


--
-- Name: KFactor; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."KFactor" (
    id text NOT NULL,
    material text NOT NULL,
    "thicknessMin" double precision NOT NULL,
    "thicknessMax" double precision NOT NULL,
    "kFactor" double precision NOT NULL
);


--
-- Name: NestingProject; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."NestingProject" (
    id text NOT NULL,
    "orderNumber" text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    strategy text DEFAULT 'minWaste'::text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    "errorMessage" text,
    "createdBy" text DEFAULT 'system'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "stepFileUrl" text,
    "pdfFileUrl" text,
    "stepStorageUri" text,
    "pdfStorageUri" text
);


--
-- Name: NestingSheet; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."NestingSheet" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "sheetRefId" text,
    "remnantId" text,
    material text NOT NULL,
    thickness double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    "sheetIndex" integer NOT NULL,
    placements jsonb NOT NULL,
    utilization double precision NOT NULL,
    waste double precision NOT NULL,
    "remnantGeom" jsonb,
    "dxfFileUrl" text,
    "steelTypeId" text,
    "steelTypeName" text,
    "dxfStorageUri" text
);


--
-- Name: Part; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."Part" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    name text NOT NULL,
    thickness double precision NOT NULL,
    material text DEFAULT 'Сталь'::text NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    contour jsonb NOT NULL,
    holes jsonb,
    quantity integer DEFAULT 1 NOT NULL,
    "isSheetMetal" boolean DEFAULT true NOT NULL,
    "grainLock" boolean DEFAULT false NOT NULL,
    "hasBends" boolean DEFAULT false NOT NULL,
    "thumbnailSvg" text,
    "classificationMethod" text,
    "classificationWarning" text,
    "steelTypeId" text,
    "steelTypeName" text,
    "steelTypeRaw" text,
    "sourceId" text,
    "sourceInputId" text,
    "sourceLabel" text,
    "sourceMachineId" text,
    "sourceMachineItemId" text,
    "sourceMachineName" text,
    "sourceProductId" text,
    "sourceType" text,
    "bboxSizeX" double precision,
    "bboxSizeY" double precision,
    "bboxSizeZ" double precision,
    "meshVolume" double precision,
    "meshArea" double precision,
    "facesCount" integer
);


--
-- Name: ProjectInput; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."ProjectInput" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "sourceId" text NOT NULL,
    "sourceType" text DEFAULT 'crm_machine_item'::text NOT NULL,
    "machineId" text,
    "machineName" text,
    "machineItemId" text,
    "productId" text,
    "productName" text,
    "drawingNumber" text,
    quantity integer DEFAULT 1 NOT NULL,
    "stepFileUrl" text,
    "pdfFileUrl" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "stepStorageUri" text,
    "pdfStorageUri" text
);


--
-- Name: ProjectSpecification; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."ProjectSpecification" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    bom jsonb NOT NULL,
    matches jsonb NOT NULL,
    "unmatchedBom" jsonb NOT NULL,
    "rawResponse" text NOT NULL,
    "tokensUsed" integer NOT NULL,
    model text NOT NULL,
    cost double precision NOT NULL,
    "budgetWarning" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Remnant; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."Remnant" (
    id text NOT NULL,
    material text NOT NULL,
    thickness double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    contour jsonb,
    "sourceOrder" text,
    "sourceSheet" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "usedInOrder" text,
    "isAvailable" boolean DEFAULT true NOT NULL
);


--
-- Name: SheetCatalog; Type: TABLE; Schema: nesting; Owner: -
--

CREATE TABLE nesting."SheetCatalog" (
    id text NOT NULL,
    material text NOT NULL,
    thickness double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    price double precision,
    stock integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AISettings AISettings_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."AISettings"
    ADD CONSTRAINT "AISettings_pkey" PRIMARY KEY (id);


--
-- Name: AIUsageLog AIUsageLog_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."AIUsageLog"
    ADD CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY (id);


--
-- Name: GapTable GapTable_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."GapTable"
    ADD CONSTRAINT "GapTable_pkey" PRIMARY KEY (id);


--
-- Name: KFactor KFactor_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."KFactor"
    ADD CONSTRAINT "KFactor_pkey" PRIMARY KEY (id);


--
-- Name: NestingProject NestingProject_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."NestingProject"
    ADD CONSTRAINT "NestingProject_pkey" PRIMARY KEY (id);


--
-- Name: NestingSheet NestingSheet_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."NestingSheet"
    ADD CONSTRAINT "NestingSheet_pkey" PRIMARY KEY (id);


--
-- Name: Part Part_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."Part"
    ADD CONSTRAINT "Part_pkey" PRIMARY KEY (id);


--
-- Name: ProjectInput ProjectInput_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."ProjectInput"
    ADD CONSTRAINT "ProjectInput_pkey" PRIMARY KEY (id);


--
-- Name: ProjectSpecification ProjectSpecification_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."ProjectSpecification"
    ADD CONSTRAINT "ProjectSpecification_pkey" PRIMARY KEY (id);


--
-- Name: Remnant Remnant_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."Remnant"
    ADD CONSTRAINT "Remnant_pkey" PRIMARY KEY (id);


--
-- Name: SheetCatalog SheetCatalog_pkey; Type: CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."SheetCatalog"
    ADD CONSTRAINT "SheetCatalog_pkey" PRIMARY KEY (id);


--
-- Name: AIUsageLog_createdAt_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "AIUsageLog_createdAt_idx" ON nesting."AIUsageLog" USING btree ("createdAt");


--
-- Name: AIUsageLog_projectId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "AIUsageLog_projectId_idx" ON nesting."AIUsageLog" USING btree ("projectId");


--
-- Name: GapTable_material_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "GapTable_material_idx" ON nesting."GapTable" USING btree (material);


--
-- Name: GapTable_material_thicknessMin_thicknessMax_key; Type: INDEX; Schema: nesting; Owner: -
--

CREATE UNIQUE INDEX "GapTable_material_thicknessMin_thicknessMax_key" ON nesting."GapTable" USING btree (material, "thicknessMin", "thicknessMax");


--
-- Name: KFactor_material_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "KFactor_material_idx" ON nesting."KFactor" USING btree (material);


--
-- Name: KFactor_material_thicknessMin_thicknessMax_key; Type: INDEX; Schema: nesting; Owner: -
--

CREATE UNIQUE INDEX "KFactor_material_thicknessMin_thicknessMax_key" ON nesting."KFactor" USING btree (material, "thicknessMin", "thicknessMax");


--
-- Name: NestingProject_createdAt_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "NestingProject_createdAt_idx" ON nesting."NestingProject" USING btree ("createdAt" DESC);


--
-- Name: NestingProject_orderNumber_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "NestingProject_orderNumber_idx" ON nesting."NestingProject" USING btree ("orderNumber");


--
-- Name: NestingProject_status_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "NestingProject_status_idx" ON nesting."NestingProject" USING btree (status);


--
-- Name: NestingSheet_projectId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "NestingSheet_projectId_idx" ON nesting."NestingSheet" USING btree ("projectId");


--
-- Name: Part_material_thickness_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Part_material_thickness_idx" ON nesting."Part" USING btree (material, thickness);


--
-- Name: Part_projectId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Part_projectId_idx" ON nesting."Part" USING btree ("projectId");


--
-- Name: Part_sourceId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Part_sourceId_idx" ON nesting."Part" USING btree ("sourceId");


--
-- Name: Part_sourceInputId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Part_sourceInputId_idx" ON nesting."Part" USING btree ("sourceInputId");


--
-- Name: Part_steelTypeId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Part_steelTypeId_idx" ON nesting."Part" USING btree ("steelTypeId");


--
-- Name: ProjectInput_projectId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "ProjectInput_projectId_idx" ON nesting."ProjectInput" USING btree ("projectId");


--
-- Name: ProjectInput_sourceId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "ProjectInput_sourceId_idx" ON nesting."ProjectInput" USING btree ("sourceId");


--
-- Name: ProjectSpecification_projectId_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "ProjectSpecification_projectId_idx" ON nesting."ProjectSpecification" USING btree ("projectId");


--
-- Name: ProjectSpecification_projectId_key; Type: INDEX; Schema: nesting; Owner: -
--

CREATE UNIQUE INDEX "ProjectSpecification_projectId_key" ON nesting."ProjectSpecification" USING btree ("projectId");


--
-- Name: Remnant_isAvailable_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Remnant_isAvailable_idx" ON nesting."Remnant" USING btree ("isAvailable");


--
-- Name: Remnant_material_thickness_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "Remnant_material_thickness_idx" ON nesting."Remnant" USING btree (material, thickness);


--
-- Name: SheetCatalog_isActive_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "SheetCatalog_isActive_idx" ON nesting."SheetCatalog" USING btree ("isActive");


--
-- Name: SheetCatalog_material_thickness_idx; Type: INDEX; Schema: nesting; Owner: -
--

CREATE INDEX "SheetCatalog_material_thickness_idx" ON nesting."SheetCatalog" USING btree (material, thickness);


--
-- Name: SheetCatalog_material_thickness_width_height_key; Type: INDEX; Schema: nesting; Owner: -
--

CREATE UNIQUE INDEX "SheetCatalog_material_thickness_width_height_key" ON nesting."SheetCatalog" USING btree (material, thickness, width, height);


--
-- Name: NestingSheet NestingSheet_projectId_fkey; Type: FK CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."NestingSheet"
    ADD CONSTRAINT "NestingSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES nesting."NestingProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Part Part_projectId_fkey; Type: FK CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."Part"
    ADD CONSTRAINT "Part_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES nesting."NestingProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Part Part_sourceInputId_fkey; Type: FK CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."Part"
    ADD CONSTRAINT "Part_sourceInputId_fkey" FOREIGN KEY ("sourceInputId") REFERENCES nesting."ProjectInput"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProjectInput ProjectInput_projectId_fkey; Type: FK CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."ProjectInput"
    ADD CONSTRAINT "ProjectInput_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES nesting."NestingProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectSpecification ProjectSpecification_projectId_fkey; Type: FK CONSTRAINT; Schema: nesting; Owner: -
--

ALTER TABLE ONLY nesting."ProjectSpecification"
    ADD CONSTRAINT "ProjectSpecification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES nesting."NestingProject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


