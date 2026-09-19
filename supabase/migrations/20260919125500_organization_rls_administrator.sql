-- Replace the remaining inline title checks in RLS; preserve all other predicates.
ALTER POLICY "business_scrap_correction_holds_select" ON "public"."business_scrap_correction_holds" USING ((private.crm_has_permission('business_scrap_reservations'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_holds.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR (public.crm_user_is_admin(auth.uid()))))))));
ALTER POLICY "business_scrap_correction_items_select" ON "public"."business_scrap_correction_items" USING ((private.crm_has_permission('business_scrap_reservations'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_items.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR (public.crm_user_is_admin(auth.uid()))))))));
ALTER POLICY "business_scrap_correction_requests_select" ON "public"."business_scrap_correction_requests" USING ((private.crm_has_permission('business_scrap_reservations'::text, 'view'::text) AND ((( SELECT auth.uid() AS uid) = requested_by) OR (( SELECT auth.uid() AS uid) = approver_id) OR (public.crm_user_is_admin(auth.uid())))));
ALTER POLICY "finance_budget_limits_select" ON "public"."finance_budget_limits" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR private.crm_has_permission('supply_finance'::text, 'view'::text))));
ALTER POLICY "finance_event_actions_modify" ON "public"."finance_event_actions" USING (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((event_type = 'expense'::finance_event_type) AND private.crm_has_permission('supply_finance'::text, 'manage'::text) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))))) WITH CHECK (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((event_type = 'expense'::finance_event_type) AND private.crm_has_permission('supply_finance'::text, 'manage'::text) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true))))))));
ALTER POLICY "finance_event_actions_select" ON "public"."finance_event_actions" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((event_type = 'expense'::finance_event_type) AND private.crm_has_permission('supply_finance'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true))))))));
ALTER POLICY "finance_expense_series_modify" ON "public"."finance_expense_series" USING (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((is_supply_plan = true) AND private.crm_has_permission('supply_finance'::text, 'manage'::text))))) WITH CHECK (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((is_supply_plan = true) AND private.crm_has_permission('supply_finance'::text, 'manage'::text)))));
ALTER POLICY "finance_expense_series_select" ON "public"."finance_expense_series" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active))))));
ALTER POLICY "finance_expenses_modify" ON "public"."finance_expenses" USING (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((is_supply_plan = true) AND private.crm_has_permission('supply_finance'::text, 'manage'::text))))) WITH CHECK (((private.crm_has_permission('finance_calendar'::text, 'manage'::text) OR private.crm_has_permission('supply_finance'::text, 'manage'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR ((is_supply_plan = true) AND private.crm_has_permission('supply_finance'::text, 'manage'::text)))));
ALTER POLICY "finance_expenses_select" ON "public"."finance_expenses" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR (responsible_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active))))));
ALTER POLICY "finance_settings_select" ON "public"."finance_settings" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR private.crm_has_permission('supply_finance'::text, 'view'::text))));
ALTER POLICY "finance_telegram_recipients_select" ON "public"."finance_telegram_recipients" USING (((private.crm_has_permission('finance_calendar'::text, 'view'::text) OR private.crm_has_permission('supply_finance'::text, 'view'::text)) AND ((public.crm_user_is_admin(auth.uid())) OR private.crm_has_permission('supply_finance'::text, 'view'::text))));
ALTER POLICY "outsourcing_transport_orders_select" ON "public"."machine_outsourcing_transport_orders" USING ((private.crm_has_permission('supply_transport'::text, 'view'::text) AND ((public.crm_user_is_admin(auth.uid())) OR private.crm_has_permission('supply_transport'::text, 'view'::text))));
ALTER POLICY "production_plan_date_change_request_items_select" ON "public"."production_plan_date_change_request_items" USING ((private.crm_has_permission('production'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM production_plan_date_change_requests r
  WHERE ((r.id = production_plan_date_change_request_items.request_id) AND ((r.requested_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid())))) OR (public.crm_user_is_admin(auth.uid())) OR (EXISTS ( SELECT 1
           FROM machines m
          WHERE ((m.id = r.machine_id) AND private.crm_has_permission('production'::text, 'view'::text) AND (m.factory_id = get_user_factory_id()))))))))));
ALTER POLICY "production_plan_date_change_requests_select" ON "public"."production_plan_date_change_requests" USING ((private.crm_has_permission('production'::text, 'view'::text) AND ((requested_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = production_plan_date_change_requests.task_id) AND (t.assigned_to = auth.uid())))) OR (public.crm_user_is_admin(auth.uid())) OR (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = production_plan_date_change_requests.machine_id) AND private.crm_has_permission('production'::text, 'view'::text) AND (m.factory_id = get_user_factory_id())))))));
ALTER POLICY "Tasks insert own or directors" ON "public"."tasks" WITH CHECK ((private.crm_has_permission('tasks'::text, 'manage'::text) AND ((assigned_to = auth.uid()) OR (public.crm_user_is_admin(auth.uid())))));
ALTER POLICY "task_delegations_select_involved" ON "public"."task_delegations" USING ((private.crm_has_permission('tasks'::text, 'view'::text) AND ((delegated_by = auth.uid()) OR (delegated_from = auth.uid()) OR (delegated_to = auth.uid()) OR (public.crm_user_is_admin(auth.uid())))));
ALTER POLICY "Tasks update own or directors" ON "public"."tasks" USING ((private.crm_has_permission('tasks'::text, 'manage'::text) AND ((assigned_to = auth.uid()) OR (public.crm_user_is_admin(auth.uid()))))) WITH CHECK ((private.crm_has_permission('tasks'::text, 'manage'::text) AND ((assigned_to = auth.uid()) OR (public.crm_user_is_admin(auth.uid())))));
ALTER POLICY "transport_trip_date_items_select" ON "public"."transport_trip_date_change_items" USING ((private.crm_has_permission('supply_transport'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM transport_trip_date_change_requests r
  WHERE ((r.id = transport_trip_date_change_items.request_id) AND ((r.requested_by = auth.uid()) OR (public.crm_user_is_admin(auth.uid())) OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid()))))))))));
ALTER POLICY "transport_trip_date_requests_select" ON "public"."transport_trip_date_change_requests" USING ((private.crm_has_permission('supply_transport'::text, 'view'::text) AND ((requested_by = auth.uid()) OR (public.crm_user_is_admin(auth.uid())) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = transport_trip_date_change_requests.task_id) AND (t.assigned_to = auth.uid())))))));
ALTER POLICY "transport_trip_need_links_select" ON "public"."transport_trip_need_links" USING ((private.crm_has_permission('supply_transport'::text, 'view'::text) AND (( SELECT (public.crm_user_is_admin(auth.uid())) AS is_director) OR private.crm_has_permission('supply_transport'::text, 'view'::text))));
ALTER POLICY "transport_trip_stops_select" ON "public"."transport_trip_stops" USING ((private.crm_has_permission('supply_transport'::text, 'view'::text) AND (( SELECT (public.crm_user_is_admin(auth.uid())) AS is_director) OR private.crm_has_permission('supply_transport'::text, 'view'::text))));

CREATE FUNCTION private.crm_account_is_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND is_active IS TRUE);
$function$;
REVOKE ALL ON FUNCTION private.crm_account_is_active() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.crm_account_is_active() TO authenticated;
-- A blocked token cannot retain access through an owner-only or always-true policy.
DO $policies$
DECLARE target record;
BEGIN
 FOR target IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity LOOP
  EXECUTE format('CREATE POLICY organization_active_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.crm_account_is_active()) WITH CHECK (private.crm_account_is_active())',target.relname);
 END LOOP;
END;
$policies$;
-- Keep existing bucket/role rules while making protected administrators independent
-- of their legacy role, and reject stale blocked sessions in Storage as well.
CREATE FUNCTION private.crm_can_access_product_storage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.is_active
  AND (public.crm_user_is_admin(u.id) OR u.role::text=ANY(ARRAY['planning_director','financial_director','commercial_director','sales_manager','engineer'])));
$function$;
REVOKE ALL ON FUNCTION private.crm_can_access_product_storage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.crm_can_access_product_storage() TO authenticated;
ALTER POLICY "Product storage read product roles" ON storage.objects USING (bucket_id='product-files' AND private.crm_can_access_product_storage());
ALTER POLICY "Catalog managers upload product storage" ON storage.objects WITH CHECK (bucket_id='product-files' AND private.crm_can_access_product_storage());
ALTER POLICY "Catalog managers update product storage" ON storage.objects USING (bucket_id='product-files' AND private.crm_can_access_product_storage()) WITH CHECK (bucket_id='product-files' AND private.crm_can_access_product_storage());
ALTER POLICY "Catalog managers delete product storage" ON storage.objects USING (bucket_id='product-files' AND private.crm_can_access_product_storage());
CREATE POLICY organization_active_account ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING (private.crm_account_is_active()) WITH CHECK (private.crm_account_is_active());
