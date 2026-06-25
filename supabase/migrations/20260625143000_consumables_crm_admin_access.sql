-- Allow users with the "Администратор CRM" position to perform every consumables action.
-- The app-level permission system already treats this position as full access; these helpers
-- keep PostgreSQL RPC/RLS checks aligned with the same rule.

CREATE OR REPLACE FUNCTION public.consumables_is_crm_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.department_members dm
    JOIN public.positions p ON p.id = dm.position_id
    WHERE dm.user_id = auth.uid()
      AND p.name = 'Администратор CRM'
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.consumables_can_view_factory(p_factory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.consumables_is_crm_admin()
    OR CASE public.get_user_role()
      WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
      WHEN 'supply_manager' THEN true
      WHEN 'procurement_head' THEN true
      WHEN 'planning_director' THEN true
      WHEN 'financial_director' THEN true
      WHEN 'commercial_director' THEN true
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.consumables_can_manage_factory(p_factory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.consumables_is_crm_admin()
    OR CASE public.get_user_role()
      WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
      WHEN 'planning_director' THEN true
      WHEN 'financial_director' THEN true
      WHEN 'commercial_director' THEN true
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.consumables_can_supply_requests()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.consumables_is_crm_admin()
    OR public.get_user_role() IN (
      'supply_manager',
      'procurement_head',
      'planning_director',
      'financial_director',
      'commercial_director'
    );
$$;

GRANT EXECUTE ON FUNCTION public.consumables_is_crm_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consumables_can_view_factory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consumables_can_manage_factory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consumables_can_supply_requests() TO authenticated;
