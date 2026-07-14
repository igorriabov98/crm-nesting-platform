DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;
DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;
DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;

CREATE TYPE public.material_category AS ENUM ('sheet_metal', 'chain_cord', 'knives', 'pipe', 'components', 'other');
CREATE TYPE public.inventory_transaction_type AS ENUM ('receipt', 'reserve', 'unreserve', 'write_off', 'adjustment');
CREATE TYPE public.stage_type AS ENUM ('cutting', 'welding', 'painting', 'assembly', 'shipping');

CREATE TABLE public.factories (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.materials (id uuid PRIMARY KEY, category public.material_category NOT NULL);
CREATE TABLE public.material_variants (id uuid PRIMARY KEY);
CREATE TABLE public.machines (
  id uuid PRIMARY KEY,
  factory_id uuid REFERENCES public.factories(id)
);
CREATE TABLE public.technologist_requests (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES public.machines(id)
);

CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  piece_length_mm numeric,
  total_quantity numeric NOT NULL DEFAULT 0,
  reserved_quantity numeric NOT NULL DEFAULT 0,
  available_quantity numeric GENERATED ALWAYS AS (GREATEST(total_quantity - reserved_quantity, 0)) STORED,
  unit text NOT NULL,
  total_secondary_quantity numeric,
  reserved_secondary_quantity numeric,
  available_secondary_quantity numeric GENERATED ALWAYS AS (
    CASE WHEN total_secondary_quantity IS NULL THEN NULL
      ELSE GREATEST(total_secondary_quantity - COALESCE(reserved_secondary_quantity, 0), 0)
    END
  ) STORED,
  secondary_unit text,
  calculated_weight_kg numeric,
  is_business_scrap boolean NOT NULL DEFAULT false,
  business_scrap_state text NOT NULL DEFAULT 'available',
  available_from_date date,
  available_from_stage_id uuid,
  source_inventory_id uuid REFERENCES public.inventory(id),
  source_reservation_id uuid,
  source_machine_id uuid REFERENCES public.machines(id),
  source_piece_length_mm numeric,
  source_nesting_project_id text,
  source_nesting_sheet_id text,
  source_remnant_geom jsonb,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_comment text,
  last_updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_quantity <= total_quantity),
  CHECK (total_secondary_quantity IS NULL OR COALESCE(reserved_secondary_quantity, 0) <= total_secondary_quantity)
);

CREATE UNIQUE INDEX inventory_material_no_variant_idx
  ON public.inventory(factory_id, material_id)
  WHERE material_variant_id IS NULL AND is_business_scrap = false;
CREATE UNIQUE INDEX inventory_material_variant_no_piece_idx
  ON public.inventory(factory_id, material_id, material_variant_id)
  WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NULL AND is_business_scrap = false;
CREATE UNIQUE INDEX inventory_material_variant_piece_idx
  ON public.inventory(factory_id, material_id, material_variant_id, piece_length_mm)
  WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NOT NULL AND is_business_scrap = false;

CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES public.inventory(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  reserved_quantity numeric NOT NULL,
  reserved_secondary_quantity numeric,
  reserved_by uuid NOT NULL REFERENCES public.users(id),
  source_inventory_id uuid REFERENCES public.inventory(id),
  original_piece_length_mm numeric,
  consumed_piece_count numeric,
  business_scrap_inventory_id uuid REFERENCES public.inventory(id),
  business_scrap_quantity numeric,
  is_cut_reservation boolean NOT NULL DEFAULT false,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES public.users(id),
  consumed_cutting_event_id uuid,
  reservation_source text NOT NULL DEFAULT 'stock',
  supply_order_schedule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_source_reservation_fk
  FOREIGN KEY (source_reservation_id) REFERENCES public.inventory_reservations(id) ON DELETE SET NULL;

CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid REFERENCES public.factories(id),
  inventory_id uuid NOT NULL REFERENCES public.inventory(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  transaction_type public.inventory_transaction_type NOT NULL,
  quantity numeric NOT NULL,
  secondary_quantity numeric,
  machine_id uuid REFERENCES public.machines(id),
  request_item_table text,
  request_item_id uuid,
  performed_by uuid NOT NULL REFERENCES public.users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.request_sheet_metal (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.technologist_requests(id),
  material_id uuid REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  reserved_from_stock_kg numeric NOT NULL DEFAULT 0
);
CREATE TABLE public.request_round_tube (id uuid PRIMARY KEY, reserved_from_stock_kg numeric NOT NULL DEFAULT 0, reserved_from_stock_m numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_circle (id uuid PRIMARY KEY, reserved_from_stock_mm numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_pipe (
  id uuid PRIMARY KEY,
  pipe_type text NOT NULL,
  reserved_from_stock_length_mm numeric NOT NULL DEFAULT 0,
  reserved_from_stock_qty numeric NOT NULL DEFAULT 0,
  reserved_from_stock_kg numeric NOT NULL DEFAULT 0
);
CREATE TABLE public.request_knives (id uuid PRIMARY KEY, reserved_from_stock_mm numeric NOT NULL DEFAULT 0, reserved_from_stock_qty numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_components (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.technologist_requests(id),
  material_id uuid REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  reserved_from_stock numeric NOT NULL DEFAULT 0
);
CREATE TABLE public.request_paint (id uuid PRIMARY KEY, reserved_from_stock_kg numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_mesh (id uuid PRIMARY KEY, reserved_from_stock_qty numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_chain_cord (
  id uuid PRIMARY KEY,
  remainder_meters numeric NOT NULL DEFAULT 0,
  reserved_from_stock_meters numeric NOT NULL DEFAULT 0
);

ALTER TABLE public.request_round_tube
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);
ALTER TABLE public.request_circle
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);
ALTER TABLE public.request_pipe
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);
ALTER TABLE public.request_knives
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id),
  ADD COLUMN length_mm numeric;
ALTER TABLE public.request_paint
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);
ALTER TABLE public.request_mesh
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);
ALTER TABLE public.request_chain_cord
  ADD COLUMN request_id uuid REFERENCES public.technologist_requests(id),
  ADD COLUMN material_id uuid REFERENCES public.materials(id),
  ADD COLUMN material_variant_id uuid REFERENCES public.material_variants(id);

CREATE TABLE public.supply_order_delivery_schedules (
  id uuid PRIMARY KEY,
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  quantity numeric NOT NULL,
  received_quantity numeric,
  allocated_quantity numeric,
  allocated_physical_quantity numeric,
  unit text NOT NULL,
  delivery_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'planned',
  delivered_at timestamptz,
  received_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservation_supply_schedule_fk
  FOREIGN KEY (supply_order_schedule_id) REFERENCES public.supply_order_delivery_schedules(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX inventory_reservation_supply_schedule_idx
  ON public.inventory_reservations(supply_order_schedule_id)
  WHERE supply_order_schedule_id IS NOT NULL;

CREATE TABLE public.production_fact_sections (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES public.production_fact_sections(id),
  production_stage_type public.stage_type
);
CREATE TABLE public.production_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  stage_type public.stage_type NOT NULL,
  workshop integer NOT NULL DEFAULT 1,
  date_start date,
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.production_machine_facts (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id),
  fact_date date NOT NULL,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id)
);
CREATE TABLE public.production_fact_cutting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  fact_id uuid NOT NULL UNIQUE REFERENCES public.production_machine_facts(id),
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id),
  fact_date date NOT NULL,
  stage_id uuid NOT NULL REFERENCES public.production_stages(id),
  previous_stage_date_start date,
  applied_stage_date_start date,
  status text NOT NULL DEFAULT 'applied',
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_by uuid REFERENCES public.users(id),
  rolled_back_at timestamptz,
  rollback_comment text
);
ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservation_cutting_event_fk
  FOREIGN KEY (consumed_cutting_event_id) REFERENCES public.production_fact_cutting_events(id);
CREATE TABLE public.production_fact_cutting_event_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.production_fact_cutting_events(id),
  reservation_id uuid REFERENCES public.inventory_reservations(id),
  inventory_id uuid NOT NULL REFERENCES public.inventory(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  reserved_quantity numeric NOT NULL,
  reserved_secondary_quantity numeric,
  is_cut_reservation boolean NOT NULL
);
CREATE TABLE public.production_fact_cutting_event_scrap_promotions (
  event_id uuid NOT NULL REFERENCES public.production_fact_cutting_events(id),
  inventory_id uuid NOT NULL REFERENCES public.inventory(id),
  previous_business_scrap_state text NOT NULL,
  PRIMARY KEY (event_id, inventory_id)
);

CREATE OR REPLACE FUNCTION public.fn_get_production_cutting_rollback_preview(
  p_machine_id uuid
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object('canRollback', true, 'blockers', '[]'::jsonb);
$$;

INSERT INTO public.factories (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Test factory');
INSERT INTO public.users (id) VALUES ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.machines (id, factory_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.materials (id, category) VALUES
  ('00000000-0000-0000-0000-000000000010', 'chain_cord'),
  ('00000000-0000-0000-0000-000000000011', 'chain_cord'),
  ('00000000-0000-0000-0000-000000000012', 'sheet_metal');
INSERT INTO public.material_variants (id) VALUES ('00000000-0000-0000-0000-000000000013');
INSERT INTO public.technologist_requests (id, machine_id)
VALUES ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000003');
INSERT INTO public.request_sheet_metal (id, request_id, material_id, material_variant_id)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000023',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013'
);
INSERT INTO public.request_chain_cord (id, remainder_meters, reserved_from_stock_meters) VALUES
  ('00000000-0000-0000-0000-000000000020', 6, 4),
  ('00000000-0000-0000-0000-000000000021', 6, 4000);
INSERT INTO public.inventory (id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 6, 4, 'м', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 6000, 4000, 'мм', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.inventory (
  id, factory_id, material_id, material_variant_id,
  total_quantity, reserved_quantity, unit, last_updated_by
) VALUES (
  '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013',
  0, 0, 'шт', '00000000-0000-0000-0000-000000000002'
);
INSERT INTO public.inventory_reservations (id, inventory_id, material_id, machine_id, request_item_table, request_item_id, reserved_quantity, reserved_by) VALUES
  ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', 4, '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000021', 4000, '00000000-0000-0000-0000-000000000002');
INSERT INTO public.inventory_reservations (
  id, inventory_id, material_id, material_variant_id, machine_id,
  request_item_table, request_item_id, reserved_quantity, reserved_by, consumed_at
) VALUES (
  '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000003',
  'request_sheet_metal',
  '00000000-0000-0000-0000-000000000022',
  1,
  '00000000-0000-0000-0000-000000000002',
  '2026-07-02 00:00:00+00'
);
INSERT INTO public.inventory_transactions (inventory_id, material_id, transaction_type, quantity, machine_id, request_item_table, request_item_id, performed_by) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'receipt', 6, '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.supply_order_delivery_schedules (id, request_item_table, request_item_id, quantity, received_quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000050', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', 6, 2, 'м');
INSERT INTO public.supply_order_delivery_schedules (
  id, request_item_table, request_item_id, quantity, received_quantity,
  unit, status, delivered_at
) VALUES (
  '00000000-0000-0000-0000-000000000051',
  'request_sheet_metal',
  '00000000-0000-0000-0000-000000000022',
  1, 1, 'шт', 'delivered', '2026-07-01 00:00:00+00'
);
