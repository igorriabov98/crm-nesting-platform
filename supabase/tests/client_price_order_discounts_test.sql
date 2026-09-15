\set ON_ERROR_STOP on

begin;

insert into public.factories(id, name, city)
values ('71000000-0000-4000-8000-000000000001', 'DISCOUNT-TEST', 'Тест');

insert into public.users(id, email, full_name, role, factory_id, is_active) values
  ('71000000-0000-4000-8000-000000000101', 'manager@discount.test', 'Менеджер скидок', 'sales_manager', '71000000-0000-4000-8000-000000000001', true),
  ('71000000-0000-4000-8000-000000000102', 'finance@discount.test', 'Финансовый директор скидок', 'financial_director', '71000000-0000-4000-8000-000000000001', true),
  ('71000000-0000-4000-8000-000000000103', 'admin@discount.test', 'Администратор скидок', 'planning_director', '71000000-0000-4000-8000-000000000001', true),
  ('71000000-0000-4000-8000-000000000104', 'other@discount.test', 'Чужой менеджер', 'sales_manager', '71000000-0000-4000-8000-000000000001', true);

insert into public.departments(id, name, factory_id)
values ('71000000-0000-4000-8000-000000000201', 'Администрирование скидок', '71000000-0000-4000-8000-000000000001');
insert into public.department_members(user_id, department_id, position_id)
select '71000000-0000-4000-8000-000000000103', '71000000-0000-4000-8000-000000000201', id
from public.positions where name = 'Администратор CRM';

insert into public.clients(id, name, public_alias, responsible_user_id)
values ('71000000-0000-4000-8000-000000000301', 'Клиент скидок', 'discount-test', '71000000-0000-4000-8000-000000000101');

insert into public.products(id, name_uk, name_en, uktzed, drawing_number, unit_weight_kg, status, created_by) values
  ('71000000-0000-4000-8000-000000000401', 'Виріб 1', 'Product 1', '7308', 'D-1', 10, 'active', '71000000-0000-4000-8000-000000000101'),
  ('71000000-0000-4000-8000-000000000402', 'Виріб 2', 'Product 2', '7308', 'D-2', 20, 'active', '71000000-0000-4000-8000-000000000101');

insert into public.client_product_prices(client_id, product_id, coating, price_eur, created_by, updated_by) values
  ('71000000-0000-4000-8000-000000000301', '71000000-0000-4000-8000-000000000401', 'zinc', 100, '71000000-0000-4000-8000-000000000101', '71000000-0000-4000-8000-000000000101'),
  ('71000000-0000-4000-8000-000000000301', '71000000-0000-4000-8000-000000000401', 'powder_coating', 200, '71000000-0000-4000-8000-000000000101', '71000000-0000-4000-8000-000000000101');

insert into public.machines(id, factory_id, client_id, name, created_by, is_archived) values
  ('71000000-0000-4000-8000-000000000501', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Прайс — обычный', '71000000-0000-4000-8000-000000000101', false),
  ('71000000-0000-4000-8000-000000000502', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Прайс — архив', '71000000-0000-4000-8000-000000000101', true),
  ('71000000-0000-4000-8000-000000000503', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Прайс — инвойс', '71000000-0000-4000-8000-000000000101', false),
  ('71000000-0000-4000-8000-000000000504', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Скидка — товары', '71000000-0000-4000-8000-000000000101', false),
  ('71000000-0000-4000-8000-000000000505', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Скидка — только образцы', '71000000-0000-4000-8000-000000000101', false),
  ('71000000-0000-4000-8000-000000000506', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Скидка — резервный админ', '71000000-0000-4000-8000-000000000101', false),
  ('71000000-0000-4000-8000-000000000507', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000301', 'Скидка — гонка решений', '71000000-0000-4000-8000-000000000101', false);

insert into public.machine_items(id, machine_id, product_id, drawing_number, product_name, weight, price, quantity, coating, is_sample) values
  ('71000000-0000-4000-8000-000000000601', '71000000-0000-4000-8000-000000000501', '71000000-0000-4000-8000-000000000401', 'D-1', 'Точное совпадение', 1, 100, 1, 'zinc', false),
  ('71000000-0000-4000-8000-000000000602', '71000000-0000-4000-8000-000000000501', '71000000-0000-4000-8000-000000000401', 'D-1', 'Ручная цена', 1, 95, 1, 'zinc', false),
  ('71000000-0000-4000-8000-000000000603', '71000000-0000-4000-8000-000000000501', '71000000-0000-4000-8000-000000000401', 'D-1', 'Образец', 1, 100, 1, 'zinc', true),
  ('71000000-0000-4000-8000-000000000604', '71000000-0000-4000-8000-000000000502', '71000000-0000-4000-8000-000000000401', 'D-1', 'Архив', 1, 100, 1, 'zinc', false),
  ('71000000-0000-4000-8000-000000000605', '71000000-0000-4000-8000-000000000503', '71000000-0000-4000-8000-000000000401', 'D-1', 'Инвойс', 1, 100, 1, 'zinc', false),
  ('71000000-0000-4000-8000-000000000606', '71000000-0000-4000-8000-000000000504', '71000000-0000-4000-8000-000000000401', 'D-1', 'Товар скидки', 1, 100, 2, 'none', false),
  ('71000000-0000-4000-8000-000000000607', '71000000-0000-4000-8000-000000000504', '71000000-0000-4000-8000-000000000401', 'D-1', 'Образец скидки', 1, 500, 1, 'none', true),
  ('71000000-0000-4000-8000-000000000608', '71000000-0000-4000-8000-000000000505', '71000000-0000-4000-8000-000000000401', 'D-1', 'Только образец', 1, 100, 1, 'none', true),
  ('71000000-0000-4000-8000-000000000609', '71000000-0000-4000-8000-000000000506', '71000000-0000-4000-8000-000000000401', 'D-1', 'Товар админа', 1, 100, 1, 'none', false),
  ('71000000-0000-4000-8000-000000000610', '71000000-0000-4000-8000-000000000507', '71000000-0000-4000-8000-000000000401', 'D-1', 'Товар гонки', 1, 100, 1, 'none', false);

insert into public.machine_expenses(machine_id, category, amount)
values ('71000000-0000-4000-8000-000000000504', 'Транспорт', 75);
insert into public.invoices(machine_id, amount, invoice_number)
values ('71000000-0000-4000-8000-000000000503', 100, 'DISCOUNT-TEST-1');

do $test$
declare
  v_adjustment uuid;
  v_result jsonb;
  v_price_request uuid;
  v_request uuid;
  v_fallback uuid;
  v_failed boolean;
begin
  v_failed := false;
  begin
    perform public.fn_adjust_client_product_prices(
      '71000000-0000-4000-8000-000000000301', 'increase', 50.01,
      array['zinc']::public.coating_type[], '71000000-0000-4000-8000-000000000101'
    );
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'percent above 50 must fail'; end if;
  if (select count(*) from public.client_price_adjustments) <> 0 then raise exception 'failed adjustment must be atomic'; end if;

  v_result := public.fn_adjust_client_product_prices(
    '71000000-0000-4000-8000-000000000301', 'increase', 10,
    array['zinc']::public.coating_type[], '71000000-0000-4000-8000-000000000101'
  );
  v_adjustment := (v_result->>'adjustmentId')::uuid;
  if v_result->>'affectedPrices' <> '1' then raise exception 'only selected coating must change'; end if;
  if (select price_eur from public.client_product_prices where coating = 'zinc') <> 110 then raise exception 'zinc price must increase'; end if;
  if (select price_eur from public.client_product_prices where coating = 'powder_coating') <> 200 then raise exception 'unselected coating changed'; end if;
  if exists (select 1 from public.client_product_prices where product_id = '71000000-0000-4000-8000-000000000402') then raise exception 'missing prices must not be created'; end if;

  v_price_request := public.fn_submit_machine_discount_request(
    '71000000-0000-4000-8000-000000000501', 5, 'Скидка до обновления прайса', '71000000-0000-4000-8000-000000000101'
  );

  v_result := public.fn_apply_client_price_adjustment_to_orders(
    v_adjustment,
    array[
      '71000000-0000-4000-8000-000000000501',
      '71000000-0000-4000-8000-000000000502',
      '71000000-0000-4000-8000-000000000503'
    ]::uuid[],
    '71000000-0000-4000-8000-000000000101'
  );
  if v_result->>'updatedPositions' <> '1' or v_result->>'skippedPositions' <> '3' then raise exception 'unexpected order update counters: %', v_result; end if;
  if v_result->'skipReasons'->>'Индивидуальная цена не совпадает со старым прайсом' <> '1'
     or v_result->'skipReasons'->>'Заказ архивирован' <> '1'
     or v_result->'skipReasons'->>'По заказу есть активный инвойс' <> '1' then raise exception 'skip reasons missing: %', v_result; end if;
  if (select price from public.machine_items where id = '71000000-0000-4000-8000-000000000601') <> 110 then raise exception 'exact price must update'; end if;
  if (select price from public.machine_items where id = '71000000-0000-4000-8000-000000000602') <> 95 then raise exception 'manual price must stay unchanged'; end if;
  if (select price from public.machine_items where id = '71000000-0000-4000-8000-000000000603') <> 100 then raise exception 'sample price must stay unchanged'; end if;
  if (select status from public.machine_discount_requests where id = v_price_request) <> 'superseded' then raise exception 'order price update must supersede active discount'; end if;
  if (select count(*) from public.tasks where machine_discount_request_id = v_price_request and status in ('pending', 'in_progress')) <> 0 then raise exception 'superseded price discount left an active task'; end if;

  v_failed := false;
  begin
    perform public.fn_submit_machine_discount_request('71000000-0000-4000-8000-000000000503', 10, 'Активный инвойс', '71000000-0000-4000-8000-000000000101');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'active invoice must block discount'; end if;

  v_failed := false;
  begin
    perform public.fn_submit_machine_discount_request('71000000-0000-4000-8000-000000000505', 10, 'Только образцы', '71000000-0000-4000-8000-000000000101');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'sample-only order must block discount'; end if;

  v_failed := false;
  begin
    perform public.fn_submit_machine_discount_request('71000000-0000-4000-8000-000000000504', 10, 'Нет прав', '71000000-0000-4000-8000-000000000104');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'unrelated manager must be denied'; end if;

  v_request := public.fn_submit_machine_discount_request(
    '71000000-0000-4000-8000-000000000504', 10, 'Коммерческая скидка', '71000000-0000-4000-8000-000000000101'
  );
  if (select items_total_before_discount from public.machine_discount_requests where id = v_request) <> 200 then raise exception 'sample leaked into goods total'; end if;
  if (select discount_amount from public.machine_discount_requests where id = v_request) <> 20 then raise exception 'discount rounding is wrong'; end if;
  if (select total_after_discount from public.machine_discount_requests where id = v_request) <> 255 then raise exception 'expenses must remain undiscounted'; end if;
  if (select count(*) from public.tasks where machine_discount_request_id = v_request and assigned_to = '71000000-0000-4000-8000-000000000102' and status = 'pending') <> 1 then raise exception 'financial task missing'; end if;

  v_failed := false;
  begin
    update public.tasks set status = 'completed' where machine_discount_request_id = v_request;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'discount task was completed without a decision'; end if;

  v_failed := false;
  begin
    update public.machine_discount_requests set discount_percent = 11 where id = v_request;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'discount snapshot was mutated'; end if;

  update public.machine_expenses set amount = 100 where machine_id = '71000000-0000-4000-8000-000000000504';
  if (select status from public.machine_discount_requests where id = v_request) <> 'pending' then raise exception 'expense change superseded discount'; end if;
  update public.machine_items set price = 600 where id = '71000000-0000-4000-8000-000000000607';
  if (select status from public.machine_discount_requests where id = v_request) <> 'pending' then raise exception 'sample change superseded discount'; end if;
  perform public.fn_approve_machine_discount_request(v_request, '71000000-0000-4000-8000-000000000102');
  if (select total_before_discount from public.machine_discount_requests where id = v_request) <> 300
     or (select total_after_discount from public.machine_discount_requests where id = v_request) <> 280 then raise exception 'approval did not refresh unchanged expenses'; end if;

  update public.machine_items set quantity = 3 where id = '71000000-0000-4000-8000-000000000606';
  if (select status from public.machine_discount_requests where id = v_request) <> 'superseded' then raise exception 'goods change must supersede approved discount'; end if;

  update public.users set is_active = false where id = '71000000-0000-4000-8000-000000000102';
  v_fallback := public.fn_submit_machine_discount_request(
    '71000000-0000-4000-8000-000000000506', 0.01, 'Минимальная скидка', '71000000-0000-4000-8000-000000000101'
  );
  if (select count(*) from public.tasks where machine_discount_request_id = v_fallback and assigned_to = '71000000-0000-4000-8000-000000000103' and status = 'pending') <> 1 then raise exception 'administrator fallback task missing'; end if;
  perform public.fn_reject_machine_discount_request(v_fallback, '71000000-0000-4000-8000-000000000103', 'Скидка не согласована');
  if (select status from public.machine_discount_requests where id = v_fallback) <> 'rejected' then raise exception 'fallback administrator rejection failed'; end if;
  update public.users set is_active = true where id = '71000000-0000-4000-8000-000000000102';

  v_request := public.fn_submit_machine_discount_request(
    '71000000-0000-4000-8000-000000000507', 50, 'Проверка конкурентного решения', '71000000-0000-4000-8000-000000000101'
  );
  v_failed := false;
  begin
    insert into public.invoices(machine_id, amount, invoice_number)
    values ('71000000-0000-4000-8000-000000000507', 100, 'DISCOUNT-TEST-PENDING');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'pending discount did not block an invoice'; end if;

  if has_table_privilege('authenticated', 'public.machine_discount_requests', 'select') then raise exception 'authenticated has protected table access'; end if;
  if has_table_privilege('anon', 'public.client_price_adjustments', 'select') then raise exception 'anon has protected table access'; end if;
  if has_function_privilege('authenticated', 'public.fn_submit_machine_discount_request(uuid,numeric,text,uuid)', 'execute') then raise exception 'authenticated has direct RPC access'; end if;
  if not has_function_privilege('service_role', 'public.fn_submit_machine_discount_request(uuid,numeric,text,uuid)', 'execute') then raise exception 'service role lacks RPC access'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.machine_discount_requests'::regclass) then raise exception 'RLS is disabled'; end if;
end;
$test$;

commit;
