-- RLS policies for client contracts used by document generation.

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_select" ON public.contracts;
CREATE POLICY "contracts_select" ON public.contracts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "contracts_insert_sales" ON public.contracts;
CREATE POLICY "contracts_insert_sales" ON public.contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );

DROP POLICY IF EXISTS "contracts_update_sales" ON public.contracts;
CREATE POLICY "contracts_update_sales" ON public.contracts
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  )
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );

DROP POLICY IF EXISTS "contracts_delete_sales" ON public.contracts;
CREATE POLICY "contracts_delete_sales" ON public.contracts
  FOR DELETE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );
