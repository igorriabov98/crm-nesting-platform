-- A warehouse receipt can be counted before its steel density is known.
ALTER TABLE public.steel_types ALTER COLUMN density_kg_mm3 DROP NOT NULL;
ALTER TABLE public.inventory_sheet_imports ALTER COLUMN weight_kg DROP NOT NULL;
ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'steel_density_completion';
ALTER TABLE public.tasks ADD COLUMN steel_type_id uuid REFERENCES public.steel_types(id);
