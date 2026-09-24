-- Sales members may see identity and prices only for companies they own.
DO $$
DECLARE
  v_department_id uuid;
  v_department_count integer;
  v_resource text;
  v_old public.department_access_permissions%ROWTYPE;
  v_new_manage boolean;
BEGIN
  SELECT count(*), (array_agg(id))[1] INTO v_department_count, v_department_id
  FROM public.departments
  WHERE name = 'Отдел продаж';
  IF v_department_count = 0 THEN
    RAISE NOTICE 'Отдел продаж отсутствует; настройка прав будет пропущена';
    RETURN;
  END IF;
  IF v_department_count <> 1 THEN
    RAISE EXCEPTION 'Ожидался ровно один Отдел продаж, найдено: %', v_department_count;
  END IF;

  FOREACH v_resource IN ARRAY ARRAY['client_identity', 'client_prices'] LOOP
    v_new_manage := v_resource = 'client_prices';
    SELECT * INTO v_old
    FROM public.department_access_permissions
    WHERE department_id = v_department_id
      AND subject_scope = 'member'
      AND resource_key = v_resource;

    INSERT INTO public.department_access_permissions (
      department_id, subject_scope, resource_key, can_view, can_manage,
      company_view_scope, company_manage_scope
    ) VALUES (
      v_department_id, 'member', v_resource, true, v_new_manage, 'own', 'own'
    )
    ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
      can_view = true,
      can_manage = EXCLUDED.can_manage,
      company_view_scope = 'own',
      company_manage_scope = 'own',
      updated_by = null;

    IF v_old.id IS NULL OR v_old.can_view IS DISTINCT FROM true
       OR v_old.can_manage IS DISTINCT FROM v_new_manage
       OR v_old.company_view_scope IS DISTINCT FROM 'own'
       OR v_old.company_manage_scope IS DISTINCT FROM 'own' THEN
      INSERT INTO public.department_access_audit_log (
        department_id, subject_scope, resource_key,
        old_can_view, old_can_manage, new_can_view, new_can_manage,
        old_factory_scope, new_factory_scope,
        old_company_view_scope, new_company_view_scope,
        old_company_manage_scope, new_company_manage_scope
      ) VALUES (
        v_department_id, 'member', v_resource,
        coalesce(v_old.can_view, false), coalesce(v_old.can_manage, false), true, v_new_manage,
        coalesce(v_old.factory_scope, 'own'), coalesce(v_old.factory_scope, 'own'),
        coalesce(v_old.company_view_scope, 'own'), 'own',
        coalesce(v_old.company_manage_scope, 'own'), 'own'
      );
    END IF;
  END LOOP;
END;
$$;

-- Catalog base prices have no client owner. Own-company rights must not expose
-- these global values through the existing product price RPCs.
CREATE OR REPLACE FUNCTION private.crm_has_global_product_price_permission(p_operation text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p_operation IN ('view', 'manage')
    AND private.crm_has_permission('client_prices', p_operation)
    AND EXISTS (
      SELECT 1 FROM public.users AS app_user
      WHERE app_user.id = auth.uid() AND app_user.is_active IS TRUE
        AND (
          EXISTS (
            SELECT 1 FROM public.department_members AS member
            JOIN public.positions AS position ON position.id = member.position_id
            WHERE member.user_id = app_user.id AND position.is_active IS TRUE
              AND position.name = 'Администратор CRM'
          )
          OR EXISTS (
            SELECT 1 FROM public.department_members AS member
            JOIN public.department_access_permissions AS permission
              ON permission.department_id = member.department_id
             AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
            WHERE member.user_id = app_user.id AND permission.resource_key = 'client_prices'
              AND CASE p_operation
                WHEN 'manage' THEN permission.can_manage AND permission.company_manage_scope = 'all'
                ELSE permission.can_view AND permission.company_view_scope = 'all'
              END
          )
        )
    );
$function$;
REVOKE ALL ON FUNCTION private.crm_has_global_product_price_permission(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.fn_get_product_base_prices(p_product_ids uuid[])
RETURNS TABLE(product_id uuid, base_price_eur numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT product.id, product.base_price_eur
  FROM public.products AS product
  WHERE product.id = ANY(COALESCE(p_product_ids, ARRAY[]::uuid[]))
    AND private.crm_has_permission('products', 'view')
    AND private.crm_has_global_product_price_permission('view');
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_product_base_price(
  p_product_id uuid, p_base_price_eur numeric
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_price numeric;
BEGIN
  IF NOT private.crm_has_permission('products', 'manage')
     OR NOT private.crm_has_global_product_price_permission('manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения цены' USING ERRCODE = '42501';
  END IF;
  IF p_base_price_eur IS NULL OR p_base_price_eur < 0 THEN
    RAISE EXCEPTION 'Цена не может быть отрицательной' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET base_price_eur = p_base_price_eur,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = p_product_id RETURNING base_price_eur INTO v_price;
  IF NOT FOUND THEN RAISE EXCEPTION 'Изделие не найдено' USING ERRCODE = 'P0002'; END IF;
  RETURN v_price;
END;
$function$;
