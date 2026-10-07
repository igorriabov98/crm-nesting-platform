-- Keep the payment's delivery date distinct from its planned payment date.
-- The existing finance_expense_supply_items relation remains the source of position links.
create table if not exists public.finance_expense_supply_dates (
  expense_id uuid not null references public.finance_expenses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  delivery_date date not null,
  allocated_amount numeric not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  primary key (expense_id, supplier_id, delivery_date)
);
create index if not exists finance_expense_supply_dates_delivery_idx
  on public.finance_expense_supply_dates(supplier_id, delivery_date);
alter table public.finance_expense_supply_dates enable row level security;
revoke all on public.finance_expense_supply_dates from public, anon, authenticated;

-- New keys identify the delivery date while preserving the established
-- supplier:payment-date:position-list prefix used by finance links.
create or replace function public.fn_supply_expense_source_is_complete(p_source_type text, p_source_key text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_source_type is distinct from 'supply_order' then false
    when p_source_key is null or p_source_key !~
      '^[0-9a-fA-F-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}:.+$' then false
    else not exists(select 1 from regexp_split_to_table(
      regexp_replace(regexp_replace(p_source_key,'^[^:]+:[^:]+:',''),
        '#delivery:[0-9]{4}-[0-9]{2}-[0-9]{2}$',''), E'\\|') token
      where token !~ '^(request_sheet_metal|request_round_tube|request_circle|request_pipe|request_knives|request_paint|request_components|request_mesh|request_chain_cord):[0-9a-fA-F-]{36}$')
  end;
$$;

create or replace function public.fn_sync_finance_expense_supply_items()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='DELETE' then return old; end if;
  delete from public.finance_expense_supply_items where expense_id=new.id;
  if new.supply_item_links_complete then
    insert into public.finance_expense_supply_items(expense_id,request_item_table,request_item_id)
    select new.id,split_part(token,':',1),split_part(token,':',2)::uuid
      from regexp_split_to_table(
        regexp_replace(regexp_replace(new.source_key,'^[^:]+:[^:]+:',''),
          '#delivery:[0-9]{4}-[0-9]{2}-[0-9]{2}$',''), E'\\|') token
      on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.fn_sync_finance_expense_supply_items() from public, anon, authenticated;

-- This helper is intentionally limited to active expenses. A legacy expense can
-- be assigned to a date only when its positions and supplier have one planned date.
create or replace function public.fn_supply_schedule_expense_origins_v1(p_schedule_ids uuid[])
returns table(expense_id uuid, schedule_id uuid, ambiguous boolean)
language sql security definer set search_path = '' as $$
  select distinct e.id, s.id,
    not exists(select 1 from public.finance_expense_supply_dates d where d.expense_id=e.id)
    and (select count(distinct s2.delivery_date)
      from public.finance_expense_supply_items l2
      join public.supply_order_delivery_schedules s2
        on s2.request_item_table=l2.request_item_table and s2.request_item_id=l2.request_item_id
      where l2.expense_id=e.id and s2.status='planned'
        and s2.supplier_id=s.supplier_id) <> 1
  from public.supply_order_delivery_schedules s
  join public.finance_expense_supply_items l
    on l.request_item_table=s.request_item_table and l.request_item_id=s.request_item_id
  join public.finance_expenses e on e.id=l.expense_id
  where s.id=any(p_schedule_ids) and s.status='planned'
    and e.source_type='supply_order' and e.status in ('planned','overdue','partially_paid','paid')
    and split_part(e.source_key, ':', 1)=s.supplier_id::text
    and (not exists(select 1 from public.finance_expense_supply_dates d where d.expense_id=e.id)
      or exists(select 1 from public.finance_expense_supply_dates d
        where d.expense_id=e.id and d.supplier_id=s.supplier_id and d.delivery_date=s.delivery_date))
  union
  select e.id,s.id,true
    from public.supply_order_delivery_schedules s
    join public.finance_expenses e on e.source_type='supply_order'
      and e.status in ('planned','overdue','partially_paid','paid')
      and e.supply_item_links_complete=false
      and split_part(e.source_key,':',1)=s.supplier_id::text
      and e.source_key like '%' || s.request_item_id::text || '%'
    where s.id=any(p_schedule_ids) and s.status='planned';
$$;
revoke all on function public.fn_supply_schedule_expense_origins_v1(uuid[]) from public, anon, authenticated;

create or replace function public.fn_get_supply_schedule_payments_v1(p_schedule_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payments jsonb; v_can_finance boolean;
begin
  if auth.uid() is null or not private.crm_has_permission('supply_orders','manage') then
    raise exception 'Недостаточно прав для просмотра графика' using errcode='42501';
  end if;
  if p_schedule_ids is null or cardinality(p_schedule_ids)=0 then
    return jsonb_build_object('payments','[]'::jsonb,'requires_finance_permission',false);
  end if;
  if exists(select 1 from public.fn_supply_schedule_expense_origins_v1(p_schedule_ids) where ambiguous) then
    raise exception 'Источник платежа требует уточнения в финансах перед изменением графика';
  end if;
  v_can_finance := private.crm_has_permission('supply_finance','manage')
    or private.crm_has_permission('finance_calendar','manage');
  if not v_can_finance and exists(select 1 from public.fn_supply_schedule_expense_origins_v1(p_schedule_ids)) then
    return jsonb_build_object('payments','[]'::jsonb,'requires_finance_permission',true);
  end if;
  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.delivery_date,p.id),'[]'::jsonb)
    into v_payments from (
      select distinct e.id,e.amount,e.currency,e.planned_date,e.paid_amount,
        s.supplier_id,s.delivery_date,e.status,
        (select array_agg(l.request_item_table || ':' || l.request_item_id::text order by l.request_item_table,l.request_item_id)
          from public.finance_expense_supply_items l where l.expense_id=e.id) as item_keys,
        (select count(*) from public.finance_expense_supply_dates d where d.expense_id=e.id) as linked_date_count
      from public.fn_supply_schedule_expense_origins_v1(p_schedule_ids) origin
      join public.finance_expenses e on e.id=origin.expense_id
      join public.supply_order_delivery_schedules s on s.id=origin.schedule_id
    ) p;
  return jsonb_build_object('payments',coalesce(v_payments,'[]'::jsonb),'requires_finance_permission',false);
end $$;
revoke all on function public.fn_get_supply_schedule_payments_v1(uuid[]) from public, anon;
grant execute on function public.fn_get_supply_schedule_payments_v1(uuid[]) to authenticated;

-- Prevent older RPCs and other callers from silently detaching a payment.
-- A private transaction marker cannot be forged with a session setting.
create table if not exists private.supply_schedule_finance_guard (
  transaction_id bigint primary key
);
revoke all on private.supply_schedule_finance_guard from public, anon, authenticated;

create or replace function public.fn_guard_paid_supply_schedule_delete_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changes_planned_schedule boolean;
begin
  if tg_op='DELETE' then
    v_changes_planned_schedule := true;
  else
    v_changes_planned_schedule := new.status='planned' and
      (new.delivery_date is distinct from old.delivery_date
        or new.supplier_id is distinct from old.supplier_id
        or new.quantity is distinct from old.quantity);
  end if;
  if old.status='planned'
    and v_changes_planned_schedule
    and not exists(select 1 from private.supply_schedule_finance_guard
      where transaction_id=txid_current())
    and exists(select 1 from public.fn_supply_schedule_expense_origins_v1(array[old.id])) then
    raise exception 'У даты есть платёж. Измените график вместе с платежом' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.fn_guard_paid_supply_schedule_delete_v1() from public, anon, authenticated;
drop trigger if exists guard_paid_supply_schedule_delete_v1 on public.supply_order_delivery_schedules;
create trigger guard_paid_supply_schedule_delete_v1 before delete or update on public.supply_order_delivery_schedules
  for each row execute function public.fn_guard_paid_supply_schedule_delete_v1();

-- One transaction replaces schedules, checks the old finance allocation and
-- either reuses an unpaid expense or creates additional expenses for a split.
create or replace function public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
  p_delete_ids uuid[], p_rows jsonb, p_items jsonb, p_expected jsonb, p_payments jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_origin record;
  v_expense record;
  v_payment jsonb;
  v_allocation jsonb;
  v_item_keys text[];
  v_seen_keys text[] := '{}';
  v_reused uuid[] := '{}';
  v_expense_id uuid;
  v_source_key text;
  v_supplier uuid;
  v_supplier_name text;
  v_delivery_date date;
  v_planned_date date;
  v_amount numeric;
  v_amount_uah numeric;
  v_rate numeric;
  v_currency text;
  v_allocated numeric;
  v_transfer uuid;
  v_ref record;
  v_item jsonb;
  v_identity jsonb;
  v_first_identity jsonb;
  v_factory uuid;
  v_first_factory uuid;
begin
  if v_actor is null or not private.crm_has_permission('supply_orders','manage') then
    raise exception 'Недостаточно прав для изменения графика поставки' using errcode='42501';
  end if;
  if coalesce(jsonb_typeof(p_payments),'null') <> 'array' then
    raise exception 'Некорректный состав платежей';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0
    or (select count(distinct i."table" || ':' || i.id::text)
        from jsonb_to_recordset(p_items) i("table" text,id uuid)) <> jsonb_array_length(p_items) then
    raise exception 'Позиции графика повторяются или не указаны';
  end if;
  for v_ref in select * from jsonb_to_recordset(p_items) i("table" text,id uuid) loop
    if public.supply_position_category(v_ref."table") is null and v_ref."table" <> 'request_round_tube' then
      raise exception 'Недопустимая категория позиции';
    end if;
    execute format('select to_jsonb(i) from public.%I i where id=$1',v_ref."table") into v_item using v_ref.id;
    if v_item is null then raise exception 'Позиция графика не найдена'; end if;
    v_identity := public.fn_receiving_material_identity_v1(v_ref."table",v_item);
    select coalesce(r.factory_id,m.factory_id) into v_factory
      from public.technologist_requests r left join public.machines m on m.id=r.machine_id
      where r.id=(v_item->>'request_id')::uuid;
    if v_factory is null then raise exception 'Завод позиции не найден'; end if;
    if v_first_identity is null then v_first_identity := v_identity; v_first_factory := v_factory;
    elsif v_identity is distinct from v_first_identity or v_factory is distinct from v_first_factory then
      raise exception 'Позиции графика относятся к разным материалам или заводам';
    end if;
  end loop;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) r(supplier_id uuid)
    where not exists(select 1 from public.suppliers s where s.id=r.supplier_id and s.is_active)) then
    raise exception 'Поставщик графика не найден или отключён';
  end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) r(
      request_item_table text,supplier_id uuid)
    where not exists(select 1 from public.supplier_material_categories c
      where c.supplier_id=r.supplier_id and (
        c.category=coalesce(public.supply_position_category(r.request_item_table),'round_tube'::public.material_category)
        or (public.supply_position_category(r.request_item_table) in ('circle','pipe')
          and c.category='round_tube')))) then
    raise exception 'Поставщик не работает с категорией материала';
  end if;
  if jsonb_array_length(p_payments)>0 and not (
    private.crm_has_permission('supply_finance','manage')
    or private.crm_has_permission('finance_calendar','manage')) then
    raise exception 'Недостаточно прав для планирования платежей' using errcode='42501';
  end if;
  if exists(select 1 from public.fn_supply_schedule_expense_origins_v1(p_delete_ids) where ambiguous) then
    raise exception 'Источник платежа требует уточнения в финансах перед изменением графика';
  end if;
  for v_origin in select distinct expense_id
    from public.fn_supply_schedule_expense_origins_v1(p_delete_ids) order by expense_id loop
    select id,amount,currency,status,paid_amount into v_expense
      from public.finance_expenses where id=v_origin.expense_id for update;
    if v_expense.status not in ('planned','overdue') or coalesce(v_expense.paid_amount,0)>0 then
      raise exception 'Оплаченный или частично оплаченный платёж нельзя перенести автоматически';
    end if;
    if not (private.crm_has_permission('supply_finance','manage')
      or private.crm_has_permission('finance_calendar','manage')) then
      raise exception 'Недостаточно прав для переноса платежа' using errcode='42501';
    end if;
    if exists(select 1 from public.finance_expense_supply_dates d where d.expense_id=v_expense.id
      and not exists(select 1 from public.supply_order_delivery_schedules s
        where s.id=any(p_delete_ids) and s.supplier_id=d.supplier_id and s.delivery_date=d.delivery_date)) then
      raise exception 'Платёж связан с другой датой графика. Разделите его в финансах перед изменением';
    end if;
    if (select coalesce(sum((payment->>'amount')::numeric),0)
      from jsonb_array_elements(p_payments) payment
      where nullif(payment->>'transfer_from_expense_id','')::uuid=v_expense.id) is distinct from v_expense.amount
      or exists(select 1 from jsonb_array_elements(p_payments) payment
        where nullif(payment->>'transfer_from_expense_id','')::uuid=v_expense.id
          and payment->>'currency' is distinct from v_expense.currency) then
      raise exception 'Суммы перенесённых платежей должны совпадать с прежним платежом в той же валюте';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_payments) payment
    where payment->>'transfer_from_expense_id' is not null
      and not exists(select 1 from public.fn_supply_schedule_expense_origins_v1(p_delete_ids) origin
        where origin.expense_id=(payment->>'transfer_from_expense_id')::uuid)) then
    raise exception 'Платёж переноса не относится к изменяемой дате';
  end if;

  insert into private.supply_schedule_finance_guard(transaction_id) values(txid_current());
  perform public.fn_replace_supply_order_delivery_schedules_v2(p_delete_ids,p_rows,p_items,p_expected);
  delete from private.supply_schedule_finance_guard where transaction_id=txid_current();

  -- Release old unique source keys only after the version-checked schedule write.
  for v_payment in select value from jsonb_array_elements(p_payments) loop
    v_transfer := nullif(v_payment->>'transfer_from_expense_id','')::uuid;
    if v_transfer is not null and not (v_transfer=any(v_reused)) then
      delete from public.finance_expense_supply_dates where expense_id=v_transfer;
      update public.finance_expenses set source_key=null,supply_item_links_complete=false,updated_by=v_actor
        where id=v_transfer and source_type='supply_order' and paid_amount=0
          and status in ('planned','overdue');
      if not found then raise exception 'Платёж изменился. Обновите страницу'; end if;
      v_reused := array_append(v_reused,v_transfer);
    end if;
  end loop;
  v_reused := '{}';

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_payment->'item_keys') <> 'array'
      or jsonb_typeof(v_payment->'delivery_allocations') <> 'array'
      or jsonb_array_length(v_payment->'delivery_allocations') <> 1 then
      raise exception 'Не указаны позиции или даты платежа';
    end if;
    v_supplier := (v_payment->>'supplier_id')::uuid;
    v_planned_date := (v_payment->>'planned_date')::date;
    v_amount := (v_payment->>'amount')::numeric;
    v_amount_uah := (v_payment->>'amount_uah')::numeric;
    v_rate := nullif(v_payment->>'exchange_rate','')::numeric;
    v_currency := v_payment->>'currency';
    v_transfer := nullif(v_payment->>'transfer_from_expense_id','')::uuid;
    select array_agg(distinct value order by value) into v_item_keys
      from jsonb_array_elements_text(v_payment->'item_keys');
    if v_supplier is null or v_planned_date is null or v_amount is null or v_amount<=0
      or round(v_amount,2)<>v_amount
      or v_amount_uah is null or v_amount_uah<=0 or v_currency not in ('UAH','EUR')
      or v_item_keys is null or cardinality(v_item_keys)=0 then
      raise exception 'Некорректные реквизиты платежа';
    end if;
    if (v_currency='UAH' and (v_rate is not null or abs(v_amount_uah-v_amount)>0.01))
      or (v_currency='EUR' and (v_rate is null or v_rate<=0
        or abs(v_amount_uah-round(v_amount*v_rate,2))>0.01)) then
      raise exception 'Некорректный пересчёт валюты платежа';
    end if;
    if exists(select 1 from unnest(v_item_keys) payment_key
      where not exists(select 1 from jsonb_to_recordset(p_items) i("table" text,id uuid)
        where payment_key=i."table" || ':' || i.id::text)) then
      raise exception 'Платёж относится к другой позиции материала';
    end if;
    select name into v_supplier_name from public.suppliers where id=v_supplier and is_active;
    if v_supplier_name is null then raise exception 'Поставщик платежа не найден или отключён'; end if;
    v_source_key := v_supplier::text || ':' || v_planned_date::text || ':' || array_to_string(v_item_keys,'|')
      || '#delivery:' || (v_payment->'delivery_allocations'->0->>'delivery_date');
    if v_payment->>'source_key' is distinct from v_source_key or v_source_key=any(v_seen_keys) then
      raise exception 'Платёж повторяется или имеет некорректную связь с заявками';
    end if;
    v_seen_keys := array_append(v_seen_keys,v_source_key);
    select coalesce(sum((allocation->>'amount')::numeric),0) into v_allocated
      from jsonb_array_elements(v_payment->'delivery_allocations') allocation;
    if v_allocated is distinct from v_amount then
      raise exception 'Суммы платежей по датам не совпадают с общей суммой';
    end if;
    for v_allocation in select value from jsonb_array_elements(v_payment->'delivery_allocations') loop
      v_delivery_date := (v_allocation->>'delivery_date')::date;
      if v_delivery_date is null or (v_allocation->>'amount')::numeric<=0
        or round((v_allocation->>'amount')::numeric,2)<>(v_allocation->>'amount')::numeric
        or exists(select 1 from unnest(v_item_keys) payment_key where not exists(
          select 1 from public.supply_order_delivery_schedules s
          join jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) r(
            request_item_table text,request_item_id uuid,delivery_date date,supplier_id uuid)
            on r.request_item_table=s.request_item_table and r.request_item_id=s.request_item_id
              and r.delivery_date=s.delivery_date and r.supplier_id=s.supplier_id
          where s.status='planned' and s.delivery_date=v_delivery_date and s.supplier_id=v_supplier
            and (s.request_item_table || ':' || s.request_item_id::text)=payment_key)) then
        raise exception 'Платёж не связан с сохранённой датой поставки';
      end if;
    end loop;
    if v_transfer is not null and not (v_transfer=any(v_reused)) then
      update public.finance_expenses set
        title='Заказ снабжения: ' || v_supplier_name,amount=v_amount,amount_uah=v_amount_uah,
        currency=v_currency,exchange_rate=v_rate,planned_date=v_planned_date,
        original_planned_date=v_planned_date,status='planned',counterparty=v_supplier_name,
        source_type='supply_order',source_key=v_source_key,updated_by=v_actor
      where id=v_transfer and source_key is null and paid_amount=0;
      if not found then raise exception 'Платёж изменился. Обновите страницу'; end if;
      v_expense_id := v_transfer;
      v_reused := array_append(v_reused,v_transfer);
    else
      insert into public.finance_expenses(
        title,amount,amount_uah,paid_amount,paid_amount_uah,category,counterparty,
        currency,exchange_rate,is_supply_plan,responsible_user_id,planned_date,
        original_planned_date,status,comment,source_type,source_key,created_by,updated_by
      ) values (
        'Заказ снабжения: ' || v_supplier_name,v_amount,v_amount_uah,0,0,
        'Прочие расходы',v_supplier_name,v_currency,v_rate,true,v_actor,
        v_planned_date,v_planned_date,'planned',
        'Позиции: ' || array_to_string(v_item_keys,', '),'supply_order',v_source_key,v_actor,v_actor
      ) returning id into v_expense_id;
    end if;
    if not exists(select 1 from public.finance_expenses e where e.id=v_expense_id
      and e.supply_item_links_complete
      and (select count(*) from public.finance_expense_supply_items l where l.expense_id=e.id)=cardinality(v_item_keys)) then
      raise exception 'Связь платежа с позициями не сохранена';
    end if;
    for v_allocation in select value from jsonb_array_elements(v_payment->'delivery_allocations') loop
      insert into public.finance_expense_supply_dates(expense_id,supplier_id,delivery_date,allocated_amount)
        values(v_expense_id,v_supplier,(v_allocation->>'delivery_date')::date,
          (v_allocation->>'amount')::numeric);
    end loop;
  end loop;
end $$;
revoke all on function public.fn_replace_supply_order_delivery_schedules_with_finance_v2(uuid[],jsonb,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function public.fn_replace_supply_order_delivery_schedules_with_finance_v2(uuid[],jsonb,jsonb,jsonb,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
