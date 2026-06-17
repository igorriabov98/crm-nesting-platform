ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS packing_gross_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS packing_net_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS packing_summary_en text,
  ADD COLUMN IF NOT EXISTS packing_summary_ua text;

CREATE TABLE IF NOT EXISTS public.machine_packing_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  start_item_number integer NOT NULL CHECK (start_item_number > 0),
  end_item_number integer NOT NULL CHECK (end_item_number > 0),
  packing_type_en text NOT NULL,
  packing_type_ua text,
  places integer NOT NULL CHECK (places > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT machine_packing_groups_range_check CHECK (end_item_number >= start_item_number)
);

CREATE INDEX IF NOT EXISTS idx_machine_packing_groups_machine
  ON public.machine_packing_groups(machine_id);

ALTER TABLE public.machine_packing_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "machine_packing_groups_select" ON public.machine_packing_groups;
CREATE POLICY "machine_packing_groups_select" ON public.machine_packing_groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_packing_groups.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "machine_packing_groups_insert" ON public.machine_packing_groups;
CREATE POLICY "machine_packing_groups_insert" ON public.machine_packing_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_packing_groups.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "machine_packing_groups_update" ON public.machine_packing_groups;
CREATE POLICY "machine_packing_groups_update" ON public.machine_packing_groups
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_packing_groups.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  )
  WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_packing_groups.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "machine_packing_groups_delete" ON public.machine_packing_groups;
CREATE POLICY "machine_packing_groups_delete" ON public.machine_packing_groups
  FOR DELETE TO authenticated
  USING (
    get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_packing_groups.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );
