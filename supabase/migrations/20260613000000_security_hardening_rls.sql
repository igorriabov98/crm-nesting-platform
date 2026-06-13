-- Security hardening for broad authenticated RLS policies.
-- Apply to the production Supabase project separately from the Vercel deploy.

CREATE OR REPLACE FUNCTION public.security_has_role(p_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_user_role()::text = ANY(p_roles);
$$;

CREATE OR REPLACE FUNCTION public.security_can_manage_request_materials()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'engineer',
    'technologist',
    'supply_manager'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.security_can_view_request_materials()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'engineer',
    'technologist',
    'supply_manager'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.security_can_manage_supply()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'supply_manager'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.security_can_manage_catalog()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'supply_manager'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.security_can_manage_nesting_catalog()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'technologist'
  ]);
$$;

-- Suppliers and supplier metadata: directors manage, supply can read for orders.
DROP POLICY IF EXISTS "Authenticated read all" ON suppliers;
DROP POLICY IF EXISTS "Authenticated insert" ON suppliers;
DROP POLICY IF EXISTS "Authenticated update" ON suppliers;
CREATE POLICY "Suppliers read supply roles" ON suppliers
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Suppliers insert directors" ON suppliers
  FOR INSERT TO authenticated WITH CHECK (public.is_director());
CREATE POLICY "Suppliers update directors" ON suppliers
  FOR UPDATE TO authenticated USING (public.is_director()) WITH CHECK (public.is_director());

DROP POLICY IF EXISTS "Authenticated read all" ON supplier_delivery_days;
DROP POLICY IF EXISTS "Authenticated insert" ON supplier_delivery_days;
DROP POLICY IF EXISTS "Authenticated update" ON supplier_delivery_days;
DROP POLICY IF EXISTS "Authenticated delete" ON supplier_delivery_days;
CREATE POLICY "Supplier delivery days read supply roles" ON supplier_delivery_days
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Supplier delivery days insert directors" ON supplier_delivery_days
  FOR INSERT TO authenticated WITH CHECK (public.is_director());
CREATE POLICY "Supplier delivery days update directors" ON supplier_delivery_days
  FOR UPDATE TO authenticated USING (public.is_director()) WITH CHECK (public.is_director());
CREATE POLICY "Supplier delivery days delete directors" ON supplier_delivery_days
  FOR DELETE TO authenticated USING (public.is_director());

DROP POLICY IF EXISTS "Authenticated read all" ON supplier_material_categories;
DROP POLICY IF EXISTS "Authenticated insert" ON supplier_material_categories;
DROP POLICY IF EXISTS "Authenticated update" ON supplier_material_categories;
DROP POLICY IF EXISTS "Authenticated delete" ON supplier_material_categories;
CREATE POLICY "Supplier categories read supply roles" ON supplier_material_categories
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Supplier categories insert directors" ON supplier_material_categories
  FOR INSERT TO authenticated WITH CHECK (public.is_director());
CREATE POLICY "Supplier categories update directors" ON supplier_material_categories
  FOR UPDATE TO authenticated USING (public.is_director()) WITH CHECK (public.is_director());
CREATE POLICY "Supplier categories delete directors" ON supplier_material_categories
  FOR DELETE TO authenticated USING (public.is_director());

-- Tasks: everybody can see tasks, but direct mutation is limited to own tasks or directors.
DROP POLICY IF EXISTS "Authenticated read all" ON tasks;
DROP POLICY IF EXISTS "Authenticated insert" ON tasks;
DROP POLICY IF EXISTS "Authenticated update" ON tasks;
CREATE POLICY "Tasks read app roles" ON tasks
  FOR SELECT TO authenticated USING (public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'sales_manager',
    'engineer',
    'technologist',
    'supply_manager',
    'production_manager',
    'procurement_head',
    'painting_head'
  ]));
CREATE POLICY "Tasks insert own or directors" ON tasks
  FOR INSERT TO authenticated WITH CHECK (assigned_to = auth.uid() OR public.is_director());
CREATE POLICY "Tasks update own or directors" ON tasks
  FOR UPDATE TO authenticated USING (assigned_to = auth.uid() OR public.is_director())
  WITH CHECK (assigned_to = auth.uid() OR public.is_director());

-- Technologist requests and all material request section rows.
DROP POLICY IF EXISTS "Authenticated read all" ON technologist_requests;
DROP POLICY IF EXISTS "Authenticated insert" ON technologist_requests;
DROP POLICY IF EXISTS "Authenticated update" ON technologist_requests;
CREATE POLICY "Technologist requests read request roles" ON technologist_requests
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Technologist requests insert request roles" ON technologist_requests
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Technologist requests update request roles" ON technologist_requests
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read all" ON request_sheet_metal;
DROP POLICY IF EXISTS "Authenticated insert" ON request_sheet_metal;
DROP POLICY IF EXISTS "Authenticated update" ON request_sheet_metal;
DROP POLICY IF EXISTS "Authenticated delete request_sheet_metal" ON request_sheet_metal;
CREATE POLICY "Request sheet metal read request roles" ON request_sheet_metal
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request sheet metal insert request roles" ON request_sheet_metal
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request sheet metal update request roles" ON request_sheet_metal
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request sheet metal delete request roles" ON request_sheet_metal
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read all" ON request_round_tube;
DROP POLICY IF EXISTS "Authenticated insert" ON request_round_tube;
DROP POLICY IF EXISTS "Authenticated update" ON request_round_tube;
DROP POLICY IF EXISTS "Authenticated delete request_round_tube" ON request_round_tube;
CREATE POLICY "Request round tube read request roles" ON request_round_tube
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request round tube insert request roles" ON request_round_tube
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request round tube update request roles" ON request_round_tube
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request round tube delete request roles" ON request_round_tube
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read all" ON request_knives;
DROP POLICY IF EXISTS "Authenticated insert" ON request_knives;
DROP POLICY IF EXISTS "Authenticated update" ON request_knives;
DROP POLICY IF EXISTS "Authenticated delete request_knives" ON request_knives;
CREATE POLICY "Request knives read request roles" ON request_knives
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request knives insert request roles" ON request_knives
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request knives update request roles" ON request_knives
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request knives delete request roles" ON request_knives
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read all" ON request_components;
DROP POLICY IF EXISTS "Authenticated insert" ON request_components;
DROP POLICY IF EXISTS "Authenticated update" ON request_components;
DROP POLICY IF EXISTS "Authenticated delete request_components" ON request_components;
CREATE POLICY "Request components read request roles" ON request_components
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request components insert request roles" ON request_components
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request components update request roles" ON request_components
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request components delete request roles" ON request_components
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read all" ON request_paint;
DROP POLICY IF EXISTS "Authenticated insert" ON request_paint;
DROP POLICY IF EXISTS "Authenticated update" ON request_paint;
DROP POLICY IF EXISTS "Authenticated delete request_paint" ON request_paint;
CREATE POLICY "Request paint read request roles" ON request_paint
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request paint insert request roles" ON request_paint
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request paint update request roles" ON request_paint
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request paint delete request roles" ON request_paint
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated insert request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated update request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated delete request_circle" ON request_circle;
CREATE POLICY "Request circle read request roles" ON request_circle
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request circle insert request roles" ON request_circle
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request circle update request roles" ON request_circle
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request circle delete request roles" ON request_circle
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated insert request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated update request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated delete request_pipe" ON request_pipe;
CREATE POLICY "Request pipe read request roles" ON request_pipe
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request pipe insert request roles" ON request_pipe
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request pipe update request roles" ON request_pipe
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request pipe delete request roles" ON request_pipe
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated insert request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated update request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated delete request_mesh" ON request_mesh;
CREATE POLICY "Request mesh read request roles" ON request_mesh
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request mesh insert request roles" ON request_mesh
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request mesh update request roles" ON request_mesh
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request mesh delete request roles" ON request_mesh
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

DROP POLICY IF EXISTS "Authenticated read request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated insert request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated update request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated delete request_chain_cord" ON request_chain_cord;
CREATE POLICY "Request chain cord read request roles" ON request_chain_cord
  FOR SELECT TO authenticated USING (public.security_can_view_request_materials());
CREATE POLICY "Request chain cord insert request roles" ON request_chain_cord
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request chain cord update request roles" ON request_chain_cord
  FOR UPDATE TO authenticated USING (public.security_can_manage_request_materials())
  WITH CHECK (public.security_can_manage_request_materials());
CREATE POLICY "Request chain cord delete request roles" ON request_chain_cord
  FOR DELETE TO authenticated USING (public.security_can_manage_request_materials());

-- Material catalog and steel types.
DROP POLICY IF EXISTS "Authenticated read materials" ON materials;
DROP POLICY IF EXISTS "Authenticated insert materials" ON materials;
DROP POLICY IF EXISTS "Authenticated update materials" ON materials;
CREATE POLICY "Materials read catalog roles" ON materials
  FOR SELECT TO authenticated USING (public.security_can_manage_catalog() OR public.security_can_view_request_materials());
CREATE POLICY "Materials insert catalog roles" ON materials
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_catalog());
CREATE POLICY "Materials update catalog roles" ON materials
  FOR UPDATE TO authenticated USING (public.security_can_manage_catalog())
  WITH CHECK (public.security_can_manage_catalog());

DROP POLICY IF EXISTS "Authenticated read variants" ON material_variants;
DROP POLICY IF EXISTS "Authenticated insert variants" ON material_variants;
DROP POLICY IF EXISTS "Authenticated update variants" ON material_variants;
CREATE POLICY "Material variants read catalog roles" ON material_variants
  FOR SELECT TO authenticated USING (public.security_can_manage_catalog() OR public.security_can_view_request_materials());
CREATE POLICY "Material variants insert catalog roles" ON material_variants
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_catalog());
CREATE POLICY "Material variants update catalog roles" ON material_variants
  FOR UPDATE TO authenticated USING (public.security_can_manage_catalog())
  WITH CHECK (public.security_can_manage_catalog());

DROP POLICY IF EXISTS "steel_types_select" ON steel_types;
DROP POLICY IF EXISTS "steel_types_all" ON steel_types;
CREATE POLICY "Steel types read nesting roles" ON steel_types
  FOR SELECT TO authenticated USING (public.security_can_manage_nesting_catalog() OR public.security_can_manage_catalog());
CREATE POLICY "Steel types insert nesting roles" ON steel_types
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_nesting_catalog() OR public.security_can_manage_catalog());
CREATE POLICY "Steel types update nesting roles" ON steel_types
  FOR UPDATE TO authenticated USING (public.security_can_manage_nesting_catalog() OR public.security_can_manage_catalog())
  WITH CHECK (public.security_can_manage_nesting_catalog() OR public.security_can_manage_catalog());
CREATE POLICY "Steel types delete directors" ON steel_types
  FOR DELETE TO authenticated USING (public.is_director());

-- Inventory direct access. SECURITY DEFINER RPCs continue to bypass RLS for service workflows.
DROP POLICY IF EXISTS "Authenticated read" ON inventory;
DROP POLICY IF EXISTS "Authenticated insert" ON inventory;
DROP POLICY IF EXISTS "Authenticated update" ON inventory;
CREATE POLICY "Inventory read supply roles" ON inventory
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Inventory insert supply roles" ON inventory
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_supply());
CREATE POLICY "Inventory update supply roles" ON inventory
  FOR UPDATE TO authenticated USING (public.security_can_manage_supply())
  WITH CHECK (public.security_can_manage_supply());

DROP POLICY IF EXISTS "Authenticated read" ON inventory_transactions;
DROP POLICY IF EXISTS "Authenticated insert" ON inventory_transactions;
CREATE POLICY "Inventory transactions read supply roles" ON inventory_transactions
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Inventory transactions insert supply roles" ON inventory_transactions
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_supply());

DROP POLICY IF EXISTS "Authenticated read" ON inventory_reservations;
DROP POLICY IF EXISTS "Authenticated insert" ON inventory_reservations;
DROP POLICY IF EXISTS "Authenticated update" ON inventory_reservations;
DROP POLICY IF EXISTS "Authenticated delete" ON inventory_reservations;
CREATE POLICY "Inventory reservations read supply roles" ON inventory_reservations
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Inventory reservations insert supply roles" ON inventory_reservations
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_supply());
CREATE POLICY "Inventory reservations update supply roles" ON inventory_reservations
  FOR UPDATE TO authenticated USING (public.security_can_manage_supply())
  WITH CHECK (public.security_can_manage_supply());
CREATE POLICY "Inventory reservations delete supply roles" ON inventory_reservations
  FOR DELETE TO authenticated USING (public.security_can_manage_supply());

-- Supply delivery schedules.
DROP POLICY IF EXISTS "Authenticated read supply_order_delivery_schedules" ON supply_order_delivery_schedules;
DROP POLICY IF EXISTS "Authenticated insert supply_order_delivery_schedules" ON supply_order_delivery_schedules;
DROP POLICY IF EXISTS "Authenticated update supply_order_delivery_schedules" ON supply_order_delivery_schedules;
CREATE POLICY "Supply schedules read supply roles" ON supply_order_delivery_schedules
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Supply schedules insert supply roles" ON supply_order_delivery_schedules
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_supply());
CREATE POLICY "Supply schedules update supply roles" ON supply_order_delivery_schedules
  FOR UPDATE TO authenticated USING (public.security_can_manage_supply())
  WITH CHECK (public.security_can_manage_supply());

DROP POLICY IF EXISTS "Authenticated read supply_order_delivery_schedule_changes" ON supply_order_delivery_schedule_changes;
DROP POLICY IF EXISTS "Authenticated insert supply_order_delivery_schedule_changes" ON supply_order_delivery_schedule_changes;
CREATE POLICY "Supply schedule changes read supply roles" ON supply_order_delivery_schedule_changes
  FOR SELECT TO authenticated USING (public.security_can_manage_supply());
CREATE POLICY "Supply schedule changes insert supply roles" ON supply_order_delivery_schedule_changes
  FOR INSERT TO authenticated WITH CHECK (public.security_can_manage_supply());

-- Private storage read for product files should stay behind product/project roles or signed routes.
DROP POLICY IF EXISTS "Authenticated read product storage" ON storage.objects;
CREATE POLICY "Product storage read product roles" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'product-files'
    AND public.security_has_role(ARRAY[
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager',
      'engineer'
    ])
  );
