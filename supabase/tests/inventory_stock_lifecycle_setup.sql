DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TYPE public.material_category AS ENUM ('chain_cord', 'knives', 'pipe', 'components', 'other');
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

CREATE TABLE public.request_sheet_metal (id uuid PRIMARY KEY, reserved_from_stock_kg numeric NOT NULL DEFAULT 0);
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
CREATE TABLE public.request_components (id uuid PRIMARY KEY, reserved_from_stock numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_paint (id uuid PRIMARY KEY, reserved_from_stock_kg numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_mesh (id uuid PRIMARY KEY, reserved_from_stock_qty numeric NOT NULL DEFAULT 0);
CREATE TABLE public.request_chain_cord (
  id uuid PRIMARY KEY,
  remainder_meters numeric NOT NULL DEFAULT 0,
  reserved_from_stock_meters numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.supply_order_delivery_schedules (
  id uuid PRIMARY KEY,
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  quantity numeric NOT NULL,
  received_quantity numeric,
  unit text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
  fact_date date NOT NULL
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
  created_at timestamptz NOT NULL DEFAULT now()
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

INSERT INTO public.factories (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Test factory');
INSERT INTO public.users (id) VALUES ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.machines (id, factory_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.materials (id, category) VALUES
  ('00000000-0000-0000-0000-000000000010', 'chain_cord'),
  ('00000000-0000-0000-0000-000000000011', 'chain_cord');
INSERT INTO public.request_chain_cord (id, remainder_meters, reserved_from_stock_meters) VALUES
  ('00000000-0000-0000-0000-000000000020', 6, 4),
  ('00000000-0000-0000-0000-000000000021', 6, 4000);
INSERT INTO public.inventory (id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 6, 4, 'м', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 6000, 4000, 'мм', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.inventory_reservations (id, inventory_id, material_id, machine_id, request_item_table, request_item_id, reserved_quantity, reserved_by) VALUES
  ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', 4, '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000021', 4000, '00000000-0000-0000-0000-000000000002');
INSERT INTO public.inventory_transactions (inventory_id, material_id, transaction_type, quantity, machine_id, request_item_table, request_item_id, performed_by) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'receipt', 6, '00000000-0000-0000-0000-000000000003', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.supply_order_delivery_schedules (id, request_item_table, request_item_id, quantity, received_quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000050', 'request_chain_cord', '00000000-0000-0000-0000-000000000020', 6, 2, 'м');
