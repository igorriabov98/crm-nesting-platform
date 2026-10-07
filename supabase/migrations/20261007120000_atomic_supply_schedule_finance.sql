-- Schedule replacement and optional supply payments either commit together or roll back together.
-- Include the unified round-tube request table in the existing normalized finance links.
alter table public.finance_expense_supply_items
  drop constraint if exists finance_expense_supply_items_table_check;
alter table public.finance_expense_supply_items
  add constraint finance_expense_supply_items_table_check check (request_item_table in (
    'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
    'request_knives', 'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ));

create or replace function public.fn_supply_expense_source_is_complete(p_source_type text, p_source_key text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_source_type is distinct from 'supply_order' then false
    when p_source_key is null
      or p_source_key !~ '^[0-9a-fA-F-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}:.+$' then false
    else not exists (
      select 1 from regexp_split_to_table(
        regexp_replace(p_source_key, '^[^:]+:[^:]+:', ''), E'\\|'
      ) token
      where token !~ '^(request_sheet_metal|request_round_tube|request_circle|request_pipe|request_knives|request_paint|request_components|request_mesh|request_chain_cord):[0-9a-fA-F-]{36}$'
    )
  end;
$$;

create or replace function public.fn_replace_supply_order_delivery_schedules_with_finance_v1(
  p_delete_ids uuid[], p_rows jsonb, p_items jsonb, p_expected jsonb, p_payments jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_payment jsonb;
  v_supplier uuid;
  v_supplier_name text;
  v_planned_date date;
  v_amount numeric;
  v_amount_uah numeric;
  v_rate numeric;
  v_currency text;
  v_item_keys text[];
  v_source_key text;
  v_seen_keys text[] := '{}';
  v_existing record;
  v_ref record;
  v_item jsonb;
  v_identity jsonb;
  v_first_identity jsonb;
  v_factory uuid;
  v_first_factory uuid;
begin
  if v_actor is null or not private.crm_has_permission('supply_orders', 'manage') then
    raise exception 'Недостаточно прав для изменения графика поставки' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_payments), 'null') <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Не переданы платежи к графику';
  end if;
  if not (private.crm_has_permission('supply_finance', 'manage')
    or private.crm_has_permission('finance_calendar', 'manage')) then
    raise exception 'Недостаточно прав для планирования платежей' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Не переданы позиции графика';
  end if;
  if (select count(distinct i."table" || ':' || i.id::text)
      from jsonb_to_recordset(p_items) as i("table" text, id uuid)) <> jsonb_array_length(p_items) then
    raise exception 'Позиции графика повторяются или не указаны';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Не передан новый график поставки';
  end if;
  for v_ref in select * from jsonb_to_recordset(p_items) as i("table" text, id uuid) loop
    if public.supply_position_category(v_ref."table") is null
      and v_ref."table" <> 'request_round_tube' then
      raise exception 'Недопустимая категория позиции';
    end if;
    execute format('select to_jsonb(i) from public.%I i where id=$1', v_ref."table")
      into v_item using v_ref.id;
    if v_item is null then raise exception 'Позиция графика не найдена'; end if;
    v_identity := public.fn_receiving_material_identity_v1(v_ref."table", v_item);
    select coalesce(r.factory_id, m.factory_id) into v_factory
      from public.technologist_requests r left join public.machines m on m.id = r.machine_id
      where r.id = (v_item->>'request_id')::uuid;
    if v_factory is null then raise exception 'Завод позиции не найден'; end if;
    if v_first_identity is null then
      v_first_identity := v_identity;
      v_first_factory := v_factory;
    elsif v_identity is distinct from v_first_identity or v_factory is distinct from v_first_factory then
      raise exception 'Позиции графика относятся к разным материалам или заводам';
    end if;
  end loop;

  -- The existing RPC locks and version-checks every selected source before replacing schedules.
  perform public.fn_replace_supply_order_delivery_schedules_v2(p_delete_ids, p_rows, p_items, p_expected);

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_payment->'item_keys') <> 'array' then
      raise exception 'Не указаны позиции платежа';
    end if;
    v_supplier := (v_payment->>'supplier_id')::uuid;
    v_planned_date := (v_payment->>'planned_date')::date;
    v_amount := (v_payment->>'amount')::numeric;
    v_amount_uah := (v_payment->>'amount_uah')::numeric;
    v_rate := nullif(v_payment->>'exchange_rate', '')::numeric;
    v_currency := v_payment->>'currency';
    select array_agg(distinct value order by value) into v_item_keys
      from jsonb_array_elements_text(v_payment->'item_keys');
    if v_supplier is null or v_planned_date is null or v_amount is null or v_amount <= 0
      or v_amount_uah is null or v_amount_uah <= 0 or v_currency is null or v_currency not in ('UAH', 'EUR')
      or v_item_keys is null or cardinality(v_item_keys) = 0 then
      raise exception 'Некорректные реквизиты платежа';
    end if;
    if (v_currency = 'UAH' and (v_rate is not null or abs(v_amount_uah - v_amount) > 0.01))
      or (v_currency = 'EUR' and (v_rate is null or v_rate <= 0
        or abs(v_amount_uah - round(v_amount * v_rate, 2)) > 0.01)) then
      raise exception 'Некорректный пересчёт валюты платежа';
    end if;
    if exists (
      select 1 from unnest(v_item_keys) as payment_key
      where not exists (
        select 1 from jsonb_to_recordset(p_items) as i("table" text, id uuid)
        where payment_key = i."table" || ':' || i.id::text
      )
    ) then
      raise exception 'Платёж относится к другой позиции материала';
    end if;
    if not exists (
      select 1 from jsonb_to_recordset(p_rows) as row(supplier_id uuid)
      where row.supplier_id = v_supplier
    ) then
      raise exception 'Поставщик платежа отсутствует в графике';
    end if;
    if exists (
      select 1 from unnest(v_item_keys) as payment_key
      where not exists (
        select 1 from public.supply_order_delivery_schedules s
        where s.status = 'planned' and s.supplier_id = v_supplier
          and (s.request_item_table || ':' || s.request_item_id::text) = payment_key
          and exists (
            select 1 from jsonb_to_recordset(p_rows) as row(
              request_item_table text, request_item_id uuid, supplier_id uuid, delivery_date date
            ) where row.request_item_table = s.request_item_table
              and row.request_item_id = s.request_item_id
              and row.supplier_id = s.supplier_id
              and row.delivery_date = s.delivery_date
          )
      )
    ) then
      raise exception 'Платёж не связан с сохранённой поставкой';
    end if;
    select s.name into v_supplier_name from public.suppliers s
      where s.id = v_supplier and s.is_active;
    if v_supplier_name is null then raise exception 'Поставщик платежа не найден или отключён'; end if;

    v_source_key := v_supplier::text || ':' || v_planned_date::text || ':' || array_to_string(v_item_keys, '|');
    if v_payment->>'source_key' is distinct from v_source_key then
      raise exception 'Некорректная связь платежа с заявками';
    end if;
    if v_source_key = any(v_seen_keys) then
      raise exception 'Платёж повторяется в одном сохранении';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_source_key);
    insert into public.finance_expenses (
      title, amount, amount_uah, paid_amount, paid_amount_uah, category, counterparty,
      currency, exchange_rate, is_supply_plan, responsible_user_id, planned_date,
      original_planned_date, status, comment, source_type, source_key, created_by, updated_by
    ) values (
      'Заказ снабжения: ' || v_supplier_name, v_amount, v_amount_uah, 0, 0,
      'Прочие расходы', v_supplier_name, v_currency, v_rate, true, v_actor,
      v_planned_date, v_planned_date, 'planned',
      'Позиции: ' || array_to_string(v_item_keys, ', '), 'supply_order', v_source_key,
      v_actor, v_actor
    ) on conflict (source_type, source_key)
      where source_type is not null and source_key is not null do nothing;

    select id, amount, amount_uah, currency, exchange_rate, planned_date, status, supply_item_links_complete
      into v_existing
      from public.finance_expenses where source_type = 'supply_order' and source_key = v_source_key;
    if not found or v_existing.amount is distinct from v_amount
      or v_existing.amount_uah is distinct from v_amount_uah
      or v_existing.currency is distinct from v_currency
      or v_existing.exchange_rate is distinct from v_rate
      or v_existing.planned_date is distinct from v_planned_date then
      raise exception 'Платёж уже существует с другими реквизитами. Измените его в финансах';
    end if;
    if v_existing.status = 'rejected' or not v_existing.supply_item_links_complete
      or (select count(*) from public.finance_expense_supply_items link
        where link.expense_id = v_existing.id) <> cardinality(v_item_keys)
      or exists (
        select 1 from unnest(v_item_keys) as payment_key
        where not exists (
          select 1 from public.finance_expense_supply_items link
          where link.expense_id = v_existing.id
            and payment_key = link.request_item_table || ':' || link.request_item_id::text
        )
      ) then
      raise exception 'Связь платежа с позициями не сохранена';
    end if;
  end loop;
end $$;

revoke all on function public.fn_replace_supply_order_delivery_schedules_with_finance_v1(uuid[], jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.fn_replace_supply_order_delivery_schedules_with_finance_v1(uuid[], jsonb, jsonb, jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
